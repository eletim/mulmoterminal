import { describe, it, expect } from "vitest";
import { commandExitKind } from "../../../src/composables/notifySound";

describe("commandExitKind", () => {
  it("calls a clean exit done", () => {
    expect(commandExitKind(0)).toBe("command-done");
  });

  it("calls any non-zero status a failure", () => {
    expect(commandExitKind(1)).toBe("command-failed");
    expect(commandExitKind(127)).toBe("command-failed");
    // A signal kill surfaces as a non-zero code too, and is still not a success.
    expect(commandExitKind(130)).toBe("command-failed");
  });

  // The server reports no code when the command never started (spawn failed) — that is a
  // failure, not a clean finish, and answering "done" there would be actively misleading.
  it("treats a missing status as a failure", () => {
    expect(commandExitKind(null)).toBe("command-failed");
  });
});
