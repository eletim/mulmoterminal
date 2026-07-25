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

export const reconnectDelayMs = (attempt: number): number => Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);

type Timer = ReturnType<typeof setTimeout>;

export interface ResilientRunnerDeps {
  /** Starts core's host runner, returning its stop function. Throws if the session is gone. */
  start: (options: HostRunnerOptions) => () => void;
  /** The options core's lifecycle handed us; onClosed is reported only once we give up. */
  options: HostRunnerOptions;
  onHealth: (health: RunnerHealth) => void;
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
  if (ctx.state === "online") return;
  ctx.deps.log.info("host runner re-subscribed");
  setState(ctx, "online");
};

const giveUp = (ctx: RunnerContext): void => {
  ctx.stopped = true;
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
  };
  // Announce the starting state rather than assuming the owner knows it: a (re)connect is
  // also what clears the notice left behind by the previous outage.
  setState(ctx, "online");
  launch(ctx);

  return () => {
    ctx.stopped = true;
    clearTimer(ctx);
    releaseUnderlying(ctx);
  };
}
