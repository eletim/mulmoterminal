// Keeps the Firestore command channel alive across outages (#823).
//
// core's startHostRunner gives up for good once its listener fails: a non-transient
// error stops it outright, and even a transient one only survives five retries (~31s
// total, and the attempt counter resets only on a successful snapshot). A laptop
// asleep — or a network away — for longer than half a minute therefore leaves the
// host permanently offline, with the phone unable to reach it and nothing said on
// this side.
//
// This wraps that runner and re-subscribes on its behalf. The give-up rule here is
// TIME, not a retry count, so a long outage no longer burns through the budget while
// nothing can possibly succeed. When even that window runs out, the closure is passed
// through to core so the client can escalate to a full re-auth from its parked blob —
// the only path that fixes an actually-dead credential.
//
// All of that still waits to be TOLD something is wrong. A channel can also fail silently:
// core's presence heartbeat swallows its write errors, so the beats the phone reads can stop
// landing while the listener never errors and nothing here ever fires. That case reported
// itself as healthy for as long as the process lived. `checkAlive` is the missing sensor —
// a periodic look at whether the host is still visible — and a negative answer is routed
// into exactly the same recovery the runner already had.
import type { HostEvent, HostRunnerOptions } from "@mulmoclaude/core/remote-host/server";
import type { RunnerHealth, RunnerHealthState } from "../../../common/remoteHostHealth.js";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
// A re-subscribe that is going to fail transiently takes core's own ladder (~31s) to
// report itself, so a shorter window would call a still-broken channel healthy.
const SETTLE_MS = 60_000;
// Past this, retrying in place cannot help: an expired credential needs the browser's
// parked blob, which only the client can replay.
const GIVE_UP_MS = 5 * 60_000;
// How often to ask whether the phone can still see us. Slower than core's one-minute
// heartbeat, because the question is "are the beats landing", not "did this one land".
const PROBE_INTERVAL_MS = 90_000;

export const reconnectDelayMs = (attempt: number): number => Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);

type Timer = ReturnType<typeof setTimeout>;

export interface ResilientRunnerDeps {
  /** Starts core's host runner, returning its stop function. Throws if the session is gone. */
  start: (options: HostRunnerOptions) => () => void;
  /** The options core's lifecycle handed us; onClosed is reported only once we give up. */
  options: HostRunnerOptions;
  onHealth: (health: RunnerHealth) => void;
  /** Positive liveness check (presenceProbe.ts). Without one the runner keeps its old
   *  behaviour of trusting silence, which is what let a dead channel report itself green. */
  checkAlive?: () => Promise<boolean | null>;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
  schedule?: (fn: () => void, ms: number) => Timer;
  cancel?: (timer: Timer) => void;
  now?: () => number;
}

interface RunnerContext {
  deps: ResilientRunnerDeps;
  schedule: (fn: () => void, ms: number) => Timer;
  cancel: (timer: Timer) => void;
  now: () => number;
  stopUnderlying: (() => void) | null;
  timer: Timer | null;
  attempt: number;
  downSince: number | null;
  lastError: string | null;
  state: RunnerHealthState;
  stopped: boolean;
  probeTimer: Timer | null;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const eventText = (event: HostEvent): string => `${event.method}: ${event.message ?? "no detail"}`;

const setState = (ctx: RunnerContext, next: RunnerHealthState): void => {
  ctx.state = next;
  ctx.deps.onHealth({ state: next, lastError: ctx.lastError, changedAt: ctx.now() });
};

const clearTimer = (ctx: RunnerContext): void => {
  if (ctx.timer !== null) ctx.cancel(ctx.timer);
  ctx.timer = null;
};

const clearProbe = (ctx: RunnerContext): void => {
  if (ctx.probeTimer !== null) ctx.cancel(ctx.probeTimer);
  ctx.probeTimer = null;
};

// Only worth asking while we believe we are up: during a reconnect the answer is already
// known, and the recovery it would trigger is the one already running.
function scheduleProbe(ctx: RunnerContext): void {
  if (ctx.stopped || !ctx.deps.checkAlive) return;
  clearProbe(ctx);
  ctx.probeTimer = ctx.schedule(() => void runProbe(ctx), PROBE_INTERVAL_MS);
}

async function runProbe(ctx: RunnerContext): Promise<void> {
  ctx.probeTimer = null;
  if (ctx.stopped || ctx.state !== "online") return;
  let alive: boolean | null;
  try {
    alive = (await ctx.deps.checkAlive?.()) ?? null;
  } catch (err) {
    // The read itself could not reach the server, which answers the question it was asking.
    ctx.lastError = `presence probe failed: ${errorText(err)}`;
    ctx.deps.log.warn(`host runner ${ctx.lastError}`);
    if (!ctx.stopped && ctx.state === "online") onUnderlyingClosed(ctx);
    return;
  }
  // A state change while the read was in flight means someone else is already on it.
  if (ctx.stopped || ctx.state !== "online") return;
  if (alive === false) {
    ctx.lastError = "presence went stale — the phone can no longer see this host";
    ctx.deps.log.warn(`host runner ${ctx.lastError}`);
    onUnderlyingClosed(ctx);
    return;
  }
  scheduleProbe(ctx);
}

// core's runner leaves its (already dead) snapshot registration in place when it goes
// offline, so release it before starting another one — otherwise every reconnect cycle
// adds one more.
const releaseUnderlying = (ctx: RunnerContext): void => {
  const stop = ctx.stopUnderlying;
  ctx.stopUnderlying = null;
  try {
    stop?.();
  } catch (err) {
    ctx.deps.log.warn(`host runner teardown failed: ${errorText(err)}`);
  }
};

// Survived the settle window: the channel is genuinely back, so the outage budget and the
// backoff ladder start fresh for the next one.
const markRecovered = (ctx: RunnerContext): void => {
  ctx.timer = null;
  ctx.downSince = null;
  ctx.attempt = 0;
  // The incident is over, so its error stops describing the channel: kept, it would be
  // reported as the cause of whatever outage comes next.
  ctx.lastError = null;
  if (ctx.state === "online") return;
  ctx.deps.log.info("host runner re-subscribed");
  setState(ctx, "online");
  scheduleProbe(ctx);
};

const giveUp = (ctx: RunnerContext): void => {
  ctx.stopped = true;
  clearProbe(ctx);
  ctx.deps.log.warn(`host runner stayed down for ${Math.round(GIVE_UP_MS / 1000)}s, giving up (${ctx.lastError ?? "no error reported"})`);
  setState(ctx, "offline");
  ctx.deps.options.onClosed?.();
};

function scheduleRelaunch(ctx: RunnerContext): void {
  const delay = reconnectDelayMs(ctx.attempt);
  ctx.attempt += 1;
  ctx.deps.log.warn(`host runner listener died (${ctx.lastError ?? "no error reported"}); re-subscribing in ${Math.round(delay / 1000)}s`);
  if (ctx.state !== "reconnecting") setState(ctx, "reconnecting");
  ctx.timer = ctx.schedule(() => launch(ctx), delay);
}

function onUnderlyingClosed(ctx: RunnerContext): void {
  if (ctx.stopped) return;
  releaseUnderlying(ctx);
  clearTimer(ctx);
  clearProbe(ctx);
  ctx.downSince ??= ctx.now();
  if (ctx.now() - ctx.downSince >= GIVE_UP_MS) giveUp(ctx);
  else scheduleRelaunch(ctx);
}

const runnerOptions = (ctx: RunnerContext): HostRunnerOptions => ({
  ...ctx.deps.options,
  onEvent: (event) => {
    // core routes these to a debug logger and drops the message with them; the error code
    // is the one thing that says whether the credential or the network is at fault.
    if (event.phase === "error") {
      ctx.lastError = eventText(event);
      ctx.deps.log.warn(`host runner event error — ${ctx.lastError}`);
    }
    ctx.deps.options.onEvent?.(event);
  },
  onClosed: () => onUnderlyingClosed(ctx),
});

function launch(ctx: RunnerContext): void {
  ctx.timer = null;
  if (ctx.stopped) return;
  try {
    ctx.stopUnderlying = ctx.deps.start(runnerOptions(ctx));
  } catch (err) {
    // The session was torn down under us (currentFirestore throws when disconnected).
    ctx.lastError = errorText(err);
    onUnderlyingClosed(ctx);
    return;
  }
  ctx.timer = ctx.schedule(() => markRecovered(ctx), SETTLE_MS);
}

export function startResilientRunner(deps: ResilientRunnerDeps): () => void {
  const ctx: RunnerContext = {
    deps,
    schedule: deps.schedule ?? setTimeout,
    cancel: deps.cancel ?? clearTimeout,
    now: deps.now ?? Date.now,
    stopUnderlying: null,
    timer: null,
    attempt: 0,
    downSince: null,
    lastError: null,
    state: "online",
    stopped: false,
    probeTimer: null,
  };
  // Announce the starting state rather than assuming the owner knows it: a (re)connect is
  // also what clears the notice left behind by the previous outage.
  setState(ctx, "online");
  launch(ctx);
  scheduleProbe(ctx);

  return () => {
    ctx.stopped = true;
    clearTimer(ctx);
    clearProbe(ctx);
    releaseUnderlying(ctx);
  };
}
