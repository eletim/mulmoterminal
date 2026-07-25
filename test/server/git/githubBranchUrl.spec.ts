import { describe, it, expect } from "vitest";
import { githubBranchUrl } from "../../../server/git/githubBranchUrl.js";

const REPO = "https://github.com/owner/repo";

describe("githubBranchUrl", () => {
  it("links to the branch tree when it has an upstream", () => {
    expect(githubBranchUrl(REPO, "main", true)).toBe(`${REPO}/tree/main`);
  });

  it("falls back to the repository root when the branch has no upstream", () => {
    // The case that decided the design: a managed worktree starts on an agent/<slug> that
    // exists only locally, so /tree/<branch> would 404 until it is pushed.
    expect(githubBranchUrl(REPO, "agent/fix-the-thing", false)).toBe(REPO);
  });

  it("keeps a branch name's slashes as path separators", () => {
    // encodeURIComponent on the whole name would emit agent%2Ffoo, which GitHub 404s.
    expect(githubBranchUrl(REPO, "agent/foo", true)).toBe(`${REPO}/tree/agent/foo`);
    expect(githubBranchUrl(REPO, "a/b/c", true)).toBe(`${REPO}/tree/a/b/c`);
  });

  it("escapes everything else in a segment", () => {
    expect(githubBranchUrl(REPO, "fix/a b", true)).toBe(`${REPO}/tree/fix/a%20b`);
    expect(githubBranchUrl(REPO, "feat/#42", true)).toBe(`${REPO}/tree/feat/%2342`);
    expect(githubBranchUrl(REPO, "feat/a?b", true)).toBe(`${REPO}/tree/feat/a%3Fb`);
    expect(githubBranchUrl(REPO, "日本語", true)).toBe(`${REPO}/tree/${encodeURIComponent("日本語")}`);
  });

  it("returns null when the dir is not a GitHub repo", () => {
    expect(githubBranchUrl(null, "main", true)).toBeNull();
    expect(githubBranchUrl(null, null, false)).toBeNull();
  });

  it("returns the root for a detached HEAD, which has no branch to link to", () => {
    expect(githubBranchUrl(REPO, null, true)).toBe(REPO);
    expect(githubBranchUrl(REPO, null, false)).toBe(REPO);
  });

  it("treats an empty branch name as no branch", () => {
    expect(githubBranchUrl(REPO, "", true)).toBe(REPO);
  });

  it("does not care what shape the repo URL is — it only appends", () => {
    // The caller's parseGithubWebUrl is what guarantees the base; this stays a pure join so
    // a future GitHub Enterprise base needs no change here.
    expect(githubBranchUrl("https://github.example.com/o/r", "main", true)).toBe("https://github.example.com/o/r/tree/main");
  });
});
