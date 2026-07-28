import { describe, it, expect } from "vitest";
import { PRESENCE_STALE_MS, presenceIsFresh } from "../../../../server/backends/remoteHost/presenceProbe";

// The whole question the probe exists to answer: is the document the phone reads still being
// written? Everything else about the probe is a Firestore round trip; this is the judgement.
const NOW = 1_800_000_000_000;
const doc = (over: Record<string, unknown> = {}) => ({ online: true, updatedAt: NOW - 1_000, ...over });

describe("presenceIsFresh", () => {
  it("is alive for a heartbeat written just now", () => {
    expect(presenceIsFresh(doc(), NOW)).toBe(true);
  });

  it("is dead once the beats stop landing", () => {
    // The reported failure: the host believes it is online while the phone sees nothing,
    // because core swallows every presence write error.
    expect(presenceIsFresh(doc({ updatedAt: NOW - PRESENCE_STALE_MS - 1 }), NOW)).toBe(false);
  });

  it("tolerates a laptop that just woke up", () => {
    // Three missed beats is deliberate slack: being wrong here costs a reconnect cycle.
    expect(presenceIsFresh(doc({ updatedAt: NOW - PRESENCE_STALE_MS + 1_000 }), NOW)).toBe(true);
  });

  it("reads a Firestore Timestamp, not just a number", () => {
    const stamp = { toMillis: () => NOW - 1_000 };
    expect(presenceIsFresh(doc({ updatedAt: stamp }), NOW)).toBe(true);
  });

  it("judges nothing when the document is missing", () => {
    // A runner that has never announced, or a core that moved the path. Calling that dead
    // would spin a reconnect loop against a host with nothing wrong with it.
    expect(presenceIsFresh(undefined, NOW)).toBeNull();
  });

  it("judges nothing while a serverTimestamp write is still in flight", () => {
    // The field reads as null until acknowledged — a write happening, not a stale one.
    expect(presenceIsFresh(doc({ updatedAt: null }), NOW)).toBeNull();
    expect(presenceIsFresh(doc({ updatedAt: undefined }), NOW)).toBeNull();
  });

  it("judges nothing when the host said goodbye on purpose", () => {
    // core writes online:false on teardown. Down by intent is not down by failure.
    expect(presenceIsFresh(doc({ online: false, updatedAt: NOW - PRESENCE_STALE_MS - 1 }), NOW)).toBeNull();
  });
});
