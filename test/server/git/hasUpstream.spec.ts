import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { hasUpstream } from "../../../server/git/git-status.js";

// Drives real git: the question is what `@{upstream}` resolves to, which a stub could only
// restate. The remote is a bare repo on disk, so nothing here touches the network.
describe("hasUpstream", () => {
  let dir: string;
  let repo: string;
  let bare: string;

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
    if (!hasGit) return;
    runGit("init", "-q", "--bare", "-b", "main", bare);
    runGit("init", "-q", "-b", "main", repo);
    g(repo, "config", "user.email", "t@t.t");
    g(repo, "config", "user.name", "t");
    g(repo, "remote", "add", "origin", bare);
    writeFileSync(path.join(repo, "README.md"), "hi\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-q", "-m", "init");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!hasGit)("is false for a branch that has never been pushed", async () => {
    expect(await hasUpstream(repo)).toBe(false);
  });

  it.skipIf(!hasGit)("is true once the branch tracks a remote branch", async () => {
    g(repo, "push", "-q", "-u", "origin", "main");
    expect(await hasUpstream(repo)).toBe(true);
  });

  // The case the feature exists for: a worktree's fresh agent/<slug> is local-only even
  // though the repo it came from is fully pushed.
  it.skipIf(!hasGit)("is false on a new local branch in a repo whose main is pushed", async () => {
    g(repo, "push", "-q", "-u", "origin", "main");
    g(repo, "checkout", "-q", "-b", "agent/fix-the-thing");
    expect(await hasUpstream(repo)).toBe(false);
  });

  it.skipIf(!hasGit)("is false on a detached HEAD", async () => {
    g(repo, "push", "-q", "-u", "origin", "main");
    const head = g(repo, "rev-parse", "HEAD").trim();
    g(repo, "checkout", "-q", head);
    expect(await hasUpstream(repo)).toBe(false);
  });

  it.skipIf(!hasGit)("is false in a worktree until its branch is pushed, then true", async () => {
    g(repo, "push", "-q", "-u", "origin", "main");
    const wt = path.join(dir, "wt");
    g(repo, "worktree", "add", "-q", wt, "-b", "agent/task");
    expect(await hasUpstream(wt)).toBe(false);
    g(wt, "push", "-q", "-u", "origin", "agent/task");
    expect(await hasUpstream(wt)).toBe(true);
  });

  it("is false for a dir that is not a repo at all", async () => {
    expect(await hasUpstream(dir)).toBe(false);
  });
});
