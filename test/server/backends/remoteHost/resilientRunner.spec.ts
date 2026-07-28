// core's host runner gives up on its Firestore listener after five tries (~31s) and never
// subscribes again — any sleep or network move outlasts that, which is how the phone ends
// up unable to reach a Mac that still looks fine (#823). These pin the wrapper that keeps
// re-subscribing, and the rule that it gives up on TIME rather than on a retry count.
import { describe, it, expect, vi } from "vitest";
import type { HostRunnerOptions } from "@mulmoclaude/core/remote-host/server";
import { startResilientRunner, reconnectDelayMs } from "../../../../server/backends/remoteHost/resilientRunner";
import type { RunnerHealth } from "../../../../common/remoteHostHealth";

const GIVE_UP_MS = 5 * 60_000;
const SETTLE_MS = 60_000;

// A controllable clock + timer queue: the wrapper's windows are minutes long, so the tests
// drive time rather than wait for it.
function fakeClock() {
  let now = 1_000_000;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const dueBefore = (target: number) => [...pending.entries()].filter(([, timer]) => timer.at <= target).sort(([, left], [, right]) => left.at - right.at)[0];
  return {
    now: () => now,
    schedule: (fn: () => void, ms: number) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (id: ReturnType<typeof setTimeout>) => void pending.delete(id as unknown as number),
    pendingCount: () => pending.size,
    advance: (ms: number) => {
      const target = now + ms;
      for (;;) {
        const due = dueBefore(target);
        if (!due) break;
        const [id, timer] = due;
        pending.delete(id);
        now = timer.at;
        timer.fn();
      }
      now = target;
    },
  };
}

// A stand-in for core's runner: keeps the options each start was given, so a test can fire
// the onClosed core would have fired.
function fakeRunner() {
  const started: HostRunnerOptions[] = [];
  const stopCalls: number[] = [];
  return {
    started,
    stopCalls,
    start: (options: HostRunnerOptions) => {
      const index = started.length;
      started.push(options);
      return () => stopCalls.push(index);
    },
    /** Fire the closure core reports when its listener has died for good. */
    die: () => started.at(-1)?.onClosed?.(),
  };
}

function setup(overrides: Partial<Parameters<typeof startResilientRunner>[0]> = {}) {
  const clock = fakeClock();
  const runner = fakeRunner();
  const health: RunnerHealth[] = [];
  const stop = startResilientRunner({
    start: runner.start,
    options: {},
    onHealth: (next) => health.push({ ...next }),
    log: { info: vi.fn(), warn: vi.fn() },
    schedule: clock.schedule,
    cancel: clock.cancel,
    now: clock.now,
    ...overrides,
  });
  return { clock, runner, health, stop };
}

// An outage nothing recovers from: every re-subscribe is killed before it can settle,
// which is what a real dead credential or a closed laptop does.
function keepFailing(clock: ReturnType<typeof fakeClock>, runner: ReturnType<typeof fakeRunner>, rounds: number): void {
  for (let attempt = 0; attempt < rounds; attempt += 1) {
    runner.die();
    clock.advance(reconnectDelayMs(attempt));
  }
}

describe("reconnectDelayMs", () => {
  it("doubles per attempt and caps at a minute", () => {
    expect(reconnectDelayMs(0)).toBe(1_000);
    expect(reconnectDelayMs(3)).toBe(8_000);
    expect(reconnectDelayMs(6)).toBe(60_000);
    expect(reconnectDelayMs(20)).toBe(60_000); // no overflow into an absurd delay
  });
});

describe("startResilientRunner", () => {
  it("starts the underlying runner and announces itself online", () => {
    const { runner, health } = setup();
    expect(runner.started).toHaveLength(1);
    expect(health).toEqual([expect.objectContaining({ state: "online", lastError: null })]);
  });

  // The whole point: core stopping is not the end of the channel.
  it("re-subscribes after the underlying runner dies", () => {
    const { clock, runner, health } = setup();
    runner.die();
    expect(health.at(-1)?.state).toBe("reconnecting");
    expect(runner.started).toHaveLength(1); // not yet — the backoff has to elapse
    clock.advance(1_000);
    expect(runner.started).toHaveLength(2);
  });

  it("backs off further on each successive death", () => {
    const { clock, runner } = setup();
    runner.die();
    clock.advance(1_000);
    runner.die();
    clock.advance(1_999); // 2s this time, not another 1s
    expect(runner.started).toHaveLength(2);
    clock.advance(1);
    expect(runner.started).toHaveLength(3);
  });

  // A re-subscribe that fails transiently needs core's own ~31s ladder to report itself,
  // so "still alive after the settle window" is the only honest recovery signal.
  it("returns to online once a re-subscribe survives the settle window", () => {
    const { clock, runner, health } = setup();
    runner.die();
    clock.advance(1_000);
    expect(health.at(-1)?.state).toBe("reconnecting");
    clock.advance(SETTLE_MS);
    expect(health.at(-1)?.state).toBe("online");
  });

  it("restarts the backoff ladder after a recovery, instead of carrying it over", () => {
    const { clock, runner } = setup();
    runner.die();
    clock.advance(1_000 + SETTLE_MS); // reconnect, then survive long enough to count
    runner.die();
    clock.advance(1_000); // 1s again, not 2s
    expect(runner.started).toHaveLength(3);
  });

  // The regression this module exists for: core counted retries, so ~31 seconds of outage
  // exhausted the budget for good.
  it("keeps retrying well past core's five attempts", () => {
    const { clock, runner, health } = setup();
    keepFailing(clock, runner, 6); // 63s of continuous failure
    expect(runner.started.length).toBeGreaterThan(5);
    expect(health.at(-1)?.state).toBe("reconnecting");
  });

  it("gives up after the outage window and reports the closure to its owner", () => {
    const onClosed = vi.fn();
    const { clock, runner, health } = setup({ options: { onClosed } });
    keepFailing(clock, runner, 11); // 303s > the 5-minute window
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(health.at(-1)?.state).toBe("offline");
  });

  it("stops retrying once it has given up", () => {
    const { clock, runner } = setup({ options: { onClosed: vi.fn() } });
    keepFailing(clock, runner, 11);
    const startedWhenGivenUp = runner.started.length;
    keepFailing(clock, runner, 5);
    expect(runner.started).toHaveLength(startedWhenGivenUp);
  });

  // The owner's onClosed marks the session disconnected; sending it on every blip would
  // make a self-healed outage look like a dead session to the client.
  it("does NOT report a closure while it is still recovering", () => {
    const onClosed = vi.fn();
    const { clock, runner } = setup({ options: { onClosed } });
    keepFailing(clock, runner, 6);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("treats a throwing start as a failed attempt rather than dying", () => {
    const clock = fakeClock();
    const starts: number[] = [];
    let failing = true;
    const stop = startResilientRunner({
      start: () => {
        starts.push(clock.now());
        if (failing) throw new Error("remote-host session is not open");
        return () => undefined;
      },
      options: {},
      onHealth: () => undefined,
      log: { info: vi.fn(), warn: vi.fn() },
      schedule: clock.schedule,
      cancel: clock.cancel,
      now: clock.now,
    });
    expect(starts).toHaveLength(1);
    failing = false;
    clock.advance(1_000);
    expect(starts).toHaveLength(2);
    stop();
  });

  it("keeps the error text from the listener, which core drops", () => {
    const { runner, health, clock } = setup();
    runner.started[0]?.onEvent?.({ phase: "error", method: "listen", message: "Missing or insufficient permissions." });
    runner.die();
    clock.advance(1_000);
    expect(health.at(-1)?.lastError).toBe("listen: Missing or insufficient permissions.");
  });

  it("forgets the incident's error once the channel has recovered", () => {
    const { clock, runner, health } = setup();
    runner.started[0]?.onEvent?.({ phase: "error", method: "listen", message: "unavailable" });
    runner.die();
    clock.advance(1_000 + SETTLE_MS);
    expect(health.at(-1)).toEqual(expect.objectContaining({ state: "online", lastError: null }));
  });

  // Kept across a recovery, an old error is reported as the cause of the NEXT outage —
  // sending diagnosis after something that was fixed minutes ago.
  it("does not blame a new outage on the previous incident's error", () => {
    const { clock, runner, health } = setup();
    runner.started[0]?.onEvent?.({ phase: "error", method: "listen", message: "unavailable" });
    runner.die();
    clock.advance(1_000 + SETTLE_MS); // recovered
    runner.die(); // a fresh outage, this one with no error event of its own
    expect(health.at(-1)?.lastError).toBeNull();
  });

  it("forwards events to the owner's handler", () => {
    const onEvent = vi.fn();
    const { runner } = setup({ options: { onEvent } });
    runner.started[0]?.onEvent?.({ phase: "done", method: "startChat" });
    expect(onEvent).toHaveBeenCalledWith({ phase: "done", method: "startChat" });
  });

  // core leaves its dead snapshot registration in place when it goes offline, so every
  // reconnect would stack another one up.
  it("tears the dead runner down before starting its replacement", () => {
    const { clock, runner } = setup();
    runner.die();
    clock.advance(1_000);
    expect(runner.stopCalls).toEqual([0]);
  });

  it("stops cleanly: no further starts, no pending timers", () => {
    const { clock, runner, stop } = setup();
    runner.die();
    stop();
    clock.advance(GIVE_UP_MS);
    expect(runner.started).toHaveLength(1);
    expect(clock.pendingCount()).toBe(0);
    expect(runner.stopCalls).toEqual([0]);
  });

  it("survives a teardown that throws", () => {
    const clock = fakeClock();
    const captured: HostRunnerOptions[] = [];
    startResilientRunner({
      start: (options) => {
        captured.push(options);
        return () => {
          throw new Error("teardown blew up");
        };
      },
      options: {},
      onHealth: () => undefined,
      log: { info: vi.fn(), warn: vi.fn() },
      schedule: clock.schedule,
      cancel: clock.cancel,
      now: clock.now,
    });
    expect(() => captured[0]?.onClosed?.()).not.toThrow();
    clock.advance(1_000);
    expect(captured).toHaveLength(2);
  });
});

// The silent failure (#823's core-side leftover): core's presence heartbeat swallows its own
// write errors, so the beats the phone reads can stop landing while the listener never errors.
// Nothing in the wrapper above fires for that — the runner reported itself green for as long
// as the process lived. `checkAlive` is the sensor; these pin that a negative answer reaches
// the SAME recovery a listener death does, and that a healthy one changes nothing.
describe("startResilientRunner — presence liveness", () => {
  const PROBE_MS = 90_000;
  const settle = (clock: ReturnType<typeof fakeClock>) => clock.advance(SETTLE_MS);

  it("re-subscribes when the host stops being visible, with no listener error at all", async () => {
    let alive: boolean | null = true;
    const { clock, runner, health } = setup({ checkAlive: () => Promise.resolve(alive) });
    expect(runner.started).toHaveLength(1);

    alive = false;
    clock.advance(PROBE_MS);
    await vi.waitFor(() => expect(health.map((h) => h.state)).toContain("reconnecting"));

    clock.advance(60_000); // let the backoff elapse
    expect(runner.started.length).toBeGreaterThan(1);
    expect(health.at(-1)?.lastError).toContain("presence");
  });

  it("treats a probe that cannot reach the server as the outage it is", async () => {
    const { clock, health } = setup({ checkAlive: () => Promise.reject(new Error("unavailable")) });
    clock.advance(PROBE_MS);
    await vi.waitFor(() => expect(health.at(-1)?.lastError).toContain("unavailable"));
    expect(health.at(-1)?.state).toBe("reconnecting");
  });

  it("keeps asking, and stays quiet, while the host is still visible", async () => {
    const checkAlive = vi.fn(() => Promise.resolve(true));
    const { clock, runner, health } = setup({ checkAlive });
    for (let i = 0; i < 3; i++) {
      clock.advance(PROBE_MS);
      await vi.waitFor(() => expect(checkAlive).toHaveBeenCalledTimes(i + 1));
    }
    expect(runner.started).toHaveLength(1); // never torn down
    expect(health.every((h) => h.state === "online")).toBe(true);
  });

  it("does not act on an answer it cannot judge", async () => {
    // A host that has never announced, or a core that moved the document. Reconnecting
    // against that would loop forever with nothing actually wrong.
    const { clock, runner } = setup({ checkAlive: () => Promise.resolve(null) });
    clock.advance(PROBE_MS * 3);
    await vi.waitFor(() => expect(runner.started).toHaveLength(1));
  });

  it("stops probing once the runner is stopped", async () => {
    const checkAlive = vi.fn(() => Promise.resolve(true));
    const { clock, stop } = setup({ checkAlive });
    stop();
    clock.advance(PROBE_MS * 3);
    expect(checkAlive).not.toHaveBeenCalled();
  });

  it("resumes probing after a recovery, so a second silent death is caught too", async () => {
    let alive: boolean | null = true;
    const checkAlive = vi.fn(() => Promise.resolve(alive));
    const { clock, runner, health } = setup({ checkAlive });

    runner.die(); // an ordinary listener death
    clock.advance(60_000); // backoff, then a fresh launch
    settle(clock); // …which survives its settle window
    expect(health.at(-1)?.state).toBe("online");

    alive = false;
    clock.advance(PROBE_MS);
    await vi.waitFor(() => expect(health.at(-1)?.state).toBe("reconnecting"));
  });
});
