// @vitest-environment node
// #1207: a worktree is one branch, so it runs one session — and the LAUNCHER greying its row out
// is only the explanation. This is the guarantee, and it is what Codex asked for on #1208: the
// client compared paths with `===`, so a directory spelled another way walked straight past it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { rmDirRetrying, GIT_TEST_TIMEOUT_MS } from "../git/wtTestUtil.js";

// The real tmux server must not be probed from a test: mocked to "nobody holds anything", which
// leaves the in-process socket as the only signal — exactly the case being set up below.
vi.mock("../../../server/infra/tmux.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/infra/tmux.js")>()),
  tmuxAttachedCounts: () => new Map<string, number>(),
}));

const { occupiedWorktreeSession } = await import("../../../server/session/worktree-session-limit.js");
const { createWorktree, gitTopLevel } = await import("../../../server/git/worktrees.js");
const { ptys } = await import("../../../server/session/registry.js");

const SESSION = "11111111-2222-3333-4444-555555555555";
const OPEN_SOCKET = { readyState: 1, OPEN: 1 };

const hasGit = (() => {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let repo = "";
let home = "";
let worktree = "";

beforeEach(async () => {
  ptys.clear();
  home = makeTempDir("wt-limit-home-");
  process.env.MULMOTERMINAL_HOME = home;
  repo = makeTempDir("wt-limit-repo-");
  if (!hasGit) return;
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
  const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
  git("init", "-b", "main");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  writeFileSync(path.join(repo, "README.md"), "hi");
  git("add", "-A");
  git("commit", "-m", "init");
  repo = (await gitTopLevel(repo)) ?? repo;
  worktree = (await createWorktree(repo, "fix login"))?.path ?? "";
}, GIT_TEST_TIMEOUT_MS);

afterEach(() => {
  ptys.clear();
  delete process.env.MULMOTERMINAL_HOME;
  rmDirRetrying(home);
  rmDirRetrying(repo);
});

// An agent this process is running, with its browser socket still open.
const occupyWorktree = () => ptys.set(SESSION, { cwd: worktree, agent: "claude", ws: OPEN_SOCKET, tmux: true } as never);

describe.skipIf(!hasGit)("occupiedWorktreeSession", () => {
  it(
    "reports no session for a worktree nobody has started in",
    async () => {
      expect(await occupiedWorktreeSession(worktree)).toBeNull();
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it(
    "reports the session occupying the worktree",
    async () => {
      occupyWorktree();
      expect(await occupiedWorktreeSession(worktree)).toEqual({ id: SESSION, attached: true, agent: "claude" });
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // The regression Codex found, on the side that can actually close it: `isManagedWorktree`
  // canonicalizes through realpath, so no spelling reaches the spawn.
  it(
    "sees through a path spelled another way",
    async () => {
      occupyWorktree();
      const aliases = [
        `${worktree}${path.sep}`,
        path.join(worktree, "."),
        path.join(worktree, "sub", ".."),
        path.join(worktree, "..", path.basename(worktree)),
      ];
      for (const alias of aliases) {
        expect(await occupiedWorktreeSession(alias), alias).not.toBeNull();
      }
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // The limit is on WORKTREES. An ordinary repository takes as many terminals as the user wants —
  // that is what the grid is for, and refusing there would break the app's main use.
  it(
    "does not limit the repository itself",
    async () => {
      ptys.set(SESSION, { cwd: repo, agent: "claude", ws: OPEN_SOCKET, tmux: true } as never);
      expect(await occupiedWorktreeSession(repo)).toBeNull();
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it(
    "does not limit a directory that is not a git repository at all",
    async () => {
      const plain = makeTempDir("wt-limit-plain-");
      try {
        expect(await occupiedWorktreeSession(plain)).toBeNull();
      } finally {
        rmDirRetrying(plain);
      }
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // A shell parked in a worktree is a terminal someone opened, not an agent editing the tree.
  // dir-session.ts leaves it out, and so this must not refuse the worktree on the strength of one.
  it(
    "does not count a plain shell as the worktree's session",
    async () => {
      ptys.set(SESSION, { cwd: worktree, agent: "shell", ws: OPEN_SOCKET, tmux: true } as never);
      expect(await occupiedWorktreeSession(worktree)).toBeNull();
    },
    GIT_TEST_TIMEOUT_MS,
  );
});
