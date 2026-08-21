// @vitest-environment node
import { describe, it, expect } from "vitest";

import { shouldSuppressPush } from "../../../server/session/taskPushRules.js";

describe("shouldSuppressPush", () => {
  it("suppresses when the session is hidden", () => {
    expect(shouldSuppressPush(true, false)).toBe(true);
  });

  it("suppresses when the session is a translation worker", () => {
    expect(shouldSuppressPush(false, true)).toBe(true);
  });

  it("suppresses when both flags are set", () => {
    expect(shouldSuppressPush(true, true)).toBe(true);
  });

  it("does not suppress a real user task", () => {
    expect(shouldSuppressPush(false, false)).toBe(false);
  });
});

// A user's SCHEDULED task is a background session in every other respect — out of the chat list,
// never bold, no grid cell — and this is the one respect where that is wrong. It is a task the
// user configured, running while they are away, so the phone is the only way they would ever hear
// about it: suppressing it silences exactly the case push exists for (Codex, PR #1196).
describe("shouldSuppressPush — a user's scheduled task", () => {
  it("lets it through, even though it is a background session", () => {
    expect(shouldSuppressPush(true, false, true)).toBe(false);
  });

  it("still suppresses every OTHER background session", () => {
    // A collection's refresh, a plugin's hidden spawnBackgroundChat: nobody configured those to
    // report to them.
    expect(shouldSuppressPush(true, false, false)).toBe(true);
    expect(shouldSuppressPush(true, false)).toBe(true); // the parameter is optional
  });

  it("refuses a translation worker whatever else is true", () => {
    // An internal helper with no output a person reads — there is nothing to tell them about, so
    // this one is not an exception waiting to be made.
    expect(shouldSuppressPush(true, true, true)).toBe(true);
    expect(shouldSuppressPush(false, true, true)).toBe(true);
  });

  it("leaves an ordinary session alone", () => {
    expect(shouldSuppressPush(false, false, false)).toBe(false);
  });
});
