import { describe, it, expect } from "vitest";
import { NOTIFY_KINDS, DEFAULT_SOUND_KINDS, isNotifyKind } from "../../common/notifyKinds.js";
import { PUSH_KINDS, isPushKind } from "../../common/pushKinds.js";

describe("notify kinds", () => {
  it("recognises the kinds that exist and nothing else", () => {
    for (const kind of NOTIFY_KINDS) expect(isNotifyKind(kind)).toBe(true);
    for (const other of ["", "Finished", "blocked", "command_done", null, undefined, 0, ["finished"]]) {
      expect(isNotifyKind(other)).toBe(false);
    }
  });

  // Same rule as DEFAULT_PUSH_KINDS, and the same reason: the four kinds added in #873 must
  // stay opt-in, or every existing user starts hearing beeps they never asked for the moment
  // they upgrade. Adding a kind and finding this red is the intended signal — leave it out of
  // the defaults so people switch it on from Settings.
  it("defaults to the two kinds that predate per-kind sounds", () => {
    expect(DEFAULT_SOUND_KINDS).toEqual(["finished", "waiting"]);
  });

  it("only ever defaults to kinds that exist", () => {
    for (const kind of DEFAULT_SOUND_KINDS) expect(isNotifyKind(kind)).toBe(true);
  });

  // The asymmetry is deliberate and load-bearing: sounds are raised in the browser, pushes by
  // the server, and the server cannot see a Run cell's exit or a PR phase poll. Pinning it here
  // means a kind added to PUSH_KINDS without a NOTIFY_KINDS entry fails loudly instead of
  // reaching a settings screen that has no row for it.
  it("is a superset of the push kinds", () => {
    for (const kind of PUSH_KINDS) expect(isNotifyKind(kind)).toBe(true);
    expect(NOTIFY_KINDS.length).toBeGreaterThan(PUSH_KINDS.length);
  });

  it("keeps the browser-only kinds out of Web Push", () => {
    for (const kind of ["command-done", "command-failed", "session-exited", "pr-ci-failed"]) {
      expect(isNotifyKind(kind)).toBe(true);
      expect(isPushKind(kind)).toBe(false);
    }
  });
});
