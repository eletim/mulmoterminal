import { describe, it, expect } from "vitest";
import { PUSH_KINDS, DEFAULT_PUSH_KINDS, isPushKind } from "../../common/pushKinds.js";

describe("push kinds", () => {
  it("recognises the kinds that exist and nothing else", () => {
    for (const kind of PUSH_KINDS) expect(isPushKind(kind)).toBe(true);
    for (const other of ["", "Finished", "blocked", null, undefined, 0, ["finished"]]) {
      expect(isPushKind(other)).toBe(false);
    }
  });

  // The two lists are DELIBERATELY separate, and this is the test that says so. A kind added
  // to PUSH_KINDS must not join DEFAULT_PUSH_KINDS, or it starts notifying every existing user
  // the moment they upgrade — which is exactly how `waiting` (36e9e72) led to #850.
  //
  // Adding a kind and finding this red is the intended signal, not a bug: leave it out of the
  // defaults so people opt in from Settings.
  it("keeps the default set to the two kinds that predate the setting", () => {
    expect(DEFAULT_PUSH_KINDS).toEqual(["finished", "waiting"]);
  });

  it("only ever defaults to kinds that exist", () => {
    for (const kind of DEFAULT_PUSH_KINDS) expect(isPushKind(kind)).toBe(true);
  });
});
