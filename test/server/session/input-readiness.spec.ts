// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createInputReadinessTracker, terminalInputReadiness, type InputReadinessSession } from "../../../server/session/input-readiness";

function record(overrides: Partial<InputReadinessSession> = {}): InputReadinessSession {
  return {
    agent: "codex",
    lifecycle: "live",
    runtime: { pty: true, tmux: true, attached: false },
    activity: { working: false, waiting: false },
    ...overrides,
  };
}

describe("input readiness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a fresh codex session not ready until startup output settles", () => {
    vi.useFakeTimers();
    const id = randomUUID();
    const tracker = createInputReadinessTracker();
    tracker.markSessionLive(id, "codex");
    tracker.noteOutput(id, "codex", "booting");

    expect(tracker.stateOf(id)).toMatchObject({ ready: false, known: true });
    vi.advanceTimersByTime(999);
    expect(tracker.stateOf(id)).toMatchObject({ ready: false });
    vi.advanceTimersByTime(1);
    expect(tracker.stateOf(id)).toEqual({
      ready: true,
      known: true,
      source: "quiet",
      reason: "codex startup output settled",
      checkedAt: expect.any(Number),
    });
  });

  it("does not expose mutable tracker internals in public state", () => {
    const id = randomUUID();
    const tracker = createInputReadinessTracker();
    tracker.markSessionLive(id, "codex");
    tracker.noteOutput(id, "codex", "booting");

    expect(tracker.stateOf(id)).not.toHaveProperty("agent");
    expect(tracker.stateOf(id)).not.toHaveProperty("scan");
    expect(tracker.stateOf(id)).not.toHaveProperty("quiet");
  });

  it("reports detached tmux survivor readiness as unknown when no process observed it", () => {
    const session = record({
      agent: "codex",
      lifecycle: "detached",
      runtime: { pty: false, tmux: true, attached: false },
      activity: { working: false, waiting: false },
    });

    expect(terminalInputReadiness(session, null)).toMatchObject({
      available: true,
      ready: false,
      known: false,
      reason: "detached tmux survivor readiness is not observable until reattached",
    });
  });

  it("treats waiting activity as input-ready even without a live readiness marker", () => {
    const session = record({
      agent: "claude",
      lifecycle: "live",
      runtime: { pty: true, tmux: true, attached: false },
      activity: { working: false, waiting: true },
    });

    expect(terminalInputReadiness(session, null)).toMatchObject({ available: true, ready: true, source: "activity" });
  });

  it("keeps a working agent unavailable for new input", () => {
    const session = record({
      agent: "codex",
      lifecycle: "live",
      runtime: { pty: true, tmux: true, attached: false },
      activity: { working: true, waiting: false },
    });

    expect(terminalInputReadiness(session, { ready: true, known: true, reason: "settled", source: "quiet", checkedAt: 10 })).toMatchObject({
      available: true,
      ready: false,
      source: "activity",
      reason: "agent is currently working",
    });
  });
});
