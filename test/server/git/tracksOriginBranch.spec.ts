import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { tracksOriginBranch } from "../../../server/git/git-status.js";

// Drives real git: the question is what `@{upstream}` resolves to, which a stub could only
// restate. The remote is a bare repo on disk, so nothing here touches the network.
describe("tracksOriginBranch", () => {
  let dir: string;
  let repo: string;
  let bare: string;
  let otherBare: string;

  // The single place this file shells out, so the PATH exemption is stated once.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
  const runGit = (...args: string[]): string => execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] }).toString();

  const hasGit = (() => {
    try {
      runGit("--version");
      return true;
    } catch {
      return false;
    }
  })();

  const g = (cwd: string, ...a: string[]) => runGit("-C", cwd, ...a);

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-upstream-")));
    repo = path.join(dir, "repo");
    bare = path.join(dir, "remote.git");
    otherBare = path.join(dir, "other.git");
    if (!hasGit) return;
    runGit("init", "-q", "--bare", "-b", "main", bare);
    runGit("init", "-q", "--bare", "-b", "main", otherBare);
    runGit("init", "-q", "-b", "main", repo);
    g(repo, "config", "user.email", "t@t.t");
    g(repo, "config", "user.name", "t");
    g(repo, "remote", "add", "origin", bare);
    g(repo, "remote", "add", "other", otherBare);
    writeFileSync(path.join(repo, "README.md"), "hi\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-q", "-m", "init");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!hasGit)("is false for a branch that has never been pushed", async () => {
    expect(await tracksOriginBranch(repo)).toBe(false);
  });

  it.skipIf(!hasGit)("is true once the branch tracks a remote branch", async () => {
    g(repo, "push", "-q", "-u", "origin", "main");
    expect(await tracksOriginBranch(repo)).toBe(true);
  });

  // The case the feature exists for: a worktree's fresh agent/<slug> is local-only even
  // though the repo it came from is fully pushed.
  it.skipIf(!hasGit)("is false on a new local branch in a repo whose main is pushed", async () => {
    g(repo, "push", "-q", "-u", "origin", "main");
    g(repo, "checkout", "-q", "-b", "agent/fix-the-thing");
    expect(await tracksOriginBranch(repo)).toBe(false);
  });

  it.skipIf(!hasGit)("is false on a detached HEAD", async () => {
    g(repo, "push", "-q", "-u", "origin", "main");
    const head = g(repo, "rev-parse", "HEAD").trim();
    g(repo, "checkout", "-q", head);
    expect(await tracksOriginBranch(repo)).toBe(false);
  });

  it.skipIf(!hasGit)("is false in a worktree until its branch is pushed, then true", async () => {
    g(repo, "push", "-q", "-u", "origin", "main");
    const wt = path.join(dir, "wt");
    g(repo, "worktree", "add", "-q", wt, "-b", "agent/task");
    expect(await tracksOriginBranch(wt)).toBe(false);
    g(wt, "push", "-q", "-u", "origin", "agent/task");
    expect(await tracksOriginBranch(wt)).toBe(true);
  });

  // The reason this asks about origin rather than "any upstream": resolveGithubUrl reads
  // remote.origin.url, so a branch pushed to a SECOND remote is absent from the repo the
  // link is built for. Answering "it has an upstream" here produces a 404 — the exact
  // failure the check exists to prevent.
  it.skipIf(!hasGit)("is false for a branch tracking a remote that isn't origin", async () => {
    g(repo, "push", "-q", "-u", "origin", "main");
    g(repo, "checkout", "-q", "-b", "feature/x");
    g(repo, "push", "-q", "-u", "other", "feature/x");
    expect(g(repo, "rev-parse", "--abbrev-ref", "@{upstream}").trim()).toBe("other/feature/x");
    expect(await tracksOriginBranch(repo)).toBe(false);
  });

  // A branch whose tracking ref was configured but has since been pruned (the remote branch
  // was deleted, or this clone never fetched it) is not on origin either.
  it.skipIf(!hasGit)("is false when the tracking ref is configured but no longer present", async () => {
    g(repo, "push", "-q", "-u", "origin", "main");
    g(repo, "update-ref", "-d", "refs/remotes/origin/main");
    expect(g(repo, "config", "--get", "branch.main.remote").trim()).toBe("origin");
    expect(await tracksOriginBranch(repo)).toBe(false);
  });

  // A remote whose name merely starts with "origin" is a different remote.
  it.skipIf(!hasGit)("does not mistake an origin-prefixed remote name for origin", async () => {
    g(repo, "remote", "add", "origin2", otherBare);
    g(repo, "push", "-q", "-u", "origin2", "main");
    expect(await tracksOriginBranch(repo)).toBe(false);
  });

  it("is false for a dir that is not a repo at all", async () => {
    expect(await tracksOriginBranch(dir)).toBe(false);
  });
});
