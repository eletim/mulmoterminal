// @vitest-environment node
import { describe, it, expect } from "vitest";
import { pickDirSession, type DirSessionCandidate } from "../../../server/session/dir-session";

const candidate = (over: Partial<DirSessionCandidate> & { id: string }): DirSessionCandidate => ({
  attached: false,
  agent: "claude",
  createdAt: 0,
  ...over,
});

// A worktree is one branch, so the launcher asks this for ONE session — and which one it names
// decides whether the row resumes, or refuses (#1207).
describe("pickDirSession", () => {
  it("has no session for a directory with no candidates", () => {
    expect(pickDirSession([])).toBeNull();
  });

  it("takes the most recent Core member when nothing is attached", () => {
    const picked = pickDirSession([candidate({ id: "old", createdAt: 10 }), candidate({ id: "new", createdAt: 20 })]);
    expect(picked).toEqual({ id: "new", attached: false, agent: "claude" });
  });

  // The held one is what a second terminal would collide with. A newer transcript in the same
  // directory must not hide it, or the row goes back to offering a session it cannot give.
  it("prefers a held session over a more recent free one", () => {
    const picked = pickDirSession([candidate({ id: "newer", createdAt: 99 }), candidate({ id: "held", createdAt: 1, attached: true })]);
    expect(picked).toEqual({ id: "held", attached: true, agent: "claude" });
  });

  it("does not give exited state special ranking because membership remains until Delete", () => {
    const picked = pickDirSession([candidate({ id: "older", createdAt: 50 }), candidate({ id: "newer", createdAt: 60 })]);
    expect(picked?.id).toBe("newer");
  });

  it("carries the agent, so the row resumes as what the session actually is", () => {
    expect(pickDirSession([candidate({ id: "cx", agent: "codex" })])?.agent).toBe("codex");
  });

  it("answers the same when a Core snapshot contains a duplicate id", () => {
    const picked = pickDirSession([candidate({ id: "s1", createdAt: 5, attached: true }), candidate({ id: "s1", createdAt: 7, attached: true })]);
    expect(picked).toEqual({ id: "s1", attached: true, agent: "claude" });
  });
});
