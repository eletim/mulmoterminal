import { describe, it, expect } from "vitest";
import { worktreeAction } from "../../../src/components/worktreeAction";

describe("worktreeAction", () => {
  it("starts a session in a worktree that has none", () => {
    expect(worktreeAction(null)).toBe("start");
  });

  it("resumes the session a worktree already has", () => {
    expect(worktreeAction({ attached: false })).toBe("resume");
  });

  // The whole point: a worktree whose session somebody is holding must not hand it over, and must
  // not start a second agent in the same working tree either (#1207).
  it("refuses a worktree whose session is held", () => {
    expect(worktreeAction({ attached: true })).toBe("busy");
  });

  // A page left open across an upgrade parses rows from a server that never sent the field. It
  // behaves as every worktree row did before this existed, rather than refusing all of them.
  it("starts when the server said nothing", () => {
    expect(worktreeAction(undefined)).toBe("start");
  });
});
