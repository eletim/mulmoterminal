// The rule under test is "only a size tmux CAN report and that DIFFERS earns a nudge" — anything
// looser resizes a healthy session, anything tighter leaves #957's blank screen in place.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTmuxSizeSync, nudgedSize, sizesAgree, type SizeSyncEvent, type TerminalSize } from "../../../server/session/tmux-size-sync.js";

const SESSION = "11111111-2222-3333-4444-555555555555";
const SETTLE_MS = 250;
const NUDGE_MS = 50;

// `window` is what tmux will claim, per call, so a test can say "wrong, then right".
function setup(windows: Array<TerminalSize | null>) {
  const resizes: TerminalSize[] = [];
  const events: SizeSyncEvent[] = [];
  const asked: string[] = [];
  let call = 0;
  const sync = createTmuxSizeSync({
    windowSizeOf: async (id) => {
      asked.push(id);
      return windows[Math.min(call++, windows.length - 1)] ?? null;
    },
    resizePty: (_id, size) => {
      resizes.push(size);
    },
    onEvent: (event) => events.push(event),
    settleMs: SETTLE_MS,
    nudgeMs: NUDGE_MS,
  });
  return { sync, resizes, events, asked };
}

// The check chains awaits between timers, so each has to be given its turn.
const runTimers = async (times = 6) => {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(SETTLE_MS + NUDGE_MS);
  }
};

describe("sizesAgree", () => {
  it("is true only when both dimensions match", () => {
    expect(sizesAgree({ cols: 120, rows: 40 }, { cols: 120, rows: 40 })).toBe(true);
    expect(sizesAgree({ cols: 120, rows: 40 }, { cols: 120, rows: 41 })).toBe(false);
    expect(sizesAgree({ cols: 80, rows: 40 }, { cols: 120, rows: 40 })).toBe(false);
  });
});

describe("nudgedSize", () => {
  it("shrinks by a row, keeping the columns", () => {
    expect(nudgedSize({ cols: 120, rows: 40 })).toEqual({ cols: 120, rows: 39 });
  });

  it("grows a one-row terminal instead, since it cannot shrink", () => {
    expect(nudgedSize({ cols: 120, rows: 1 })).toEqual({ cols: 120, rows: 2 });
  });
});

describe("createTmuxSizeSync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("leaves a session alone when tmux agrees with the client", async () => {
    const { sync, resizes, events } = setup([{ cols: 120, rows: 40 }]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    await runTimers();
    expect(resizes).toEqual([]);
    expect(events).toEqual([]);
  });

  it("nudges a row off and straight back when the window disagrees", async () => {
    const { sync, resizes, events } = setup([
      { cols: 80, rows: 24 },
      { cols: 120, rows: 40 },
    ]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    await runTimers();
    expect(resizes).toEqual([
      { cols: 120, rows: 39 },
      { cols: 120, rows: 40 },
    ]);
    expect(events).toEqual([{ kind: "repairing", id: SESSION, wanted: { cols: 120, rows: 40 }, seen: { cols: 80, rows: 24 } }]);
  });

  it("says so when the window did not follow the nudge", async () => {
    // The gap then has a mechanism the measured ones don't cover — worth a line in the log
    // rather than a silent retry loop against a window that will not move.
    const { sync, events } = setup([{ cols: 80, rows: 24 }]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    await runTimers();
    expect(events.map((e) => e.kind)).toEqual(["repairing", "still-wrong"]);
  });

  it("never nudges on an answer tmux could not give", async () => {
    // A dead session and a disagreeing one look the same from here; resizing on `null` would
    // fight a session that is merely gone.
    const { sync, resizes, events } = setup([null]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    await runTimers();
    expect(resizes).toEqual([]);
    expect(events).toEqual([]);
  });

  it("probes once for a burst of resize frames, using the last size", async () => {
    // A splitter drag emits one frame per pointermove; one probe per drag is the point.
    const { sync, asked, resizes } = setup([
      { cols: 80, rows: 24 },
      { cols: 137, rows: 41 },
    ]);
    sync.requestCheck(SESSION, { cols: 100, rows: 30 });
    await vi.advanceTimersByTimeAsync(SETTLE_MS / 2);
    sync.requestCheck(SESSION, { cols: 120, rows: 35 });
    await vi.advanceTimersByTimeAsync(SETTLE_MS / 2);
    sync.requestCheck(SESSION, { cols: 137, rows: 41 });
    await runTimers();
    expect(asked).toHaveLength(2); // the probe, then the re-check after the nudge
    expect(resizes).toEqual([
      { cols: 137, rows: 40 },
      { cols: 137, rows: 41 },
    ]);
  });

  it("does not probe a check that was cancelled before it settled", async () => {
    const { sync, asked, resizes } = setup([{ cols: 80, rows: 24 }]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    sync.cancel(SESSION);
    await runTimers();
    expect(asked).toEqual([]);
    expect(resizes).toEqual([]);
  });

  it("keeps sessions apart, so one cell's burst cannot cancel another's check", async () => {
    const other = "99999999-8888-7777-6666-555555555555";
    const { sync, asked } = setup([{ cols: 120, rows: 40 }]);
    sync.requestCheck(SESSION, { cols: 120, rows: 40 });
    sync.requestCheck(other, { cols: 120, rows: 40 });
    await runTimers();
    expect(asked.sort()).toEqual([SESSION, other].sort());
  });
});
