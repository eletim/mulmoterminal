// @vitest-environment node
// #1207: a worktree is one branch, so it runs one session — and the LAUNCHER greying its row out
// is only the explanation. This is the guarantee, and it is what Codex asked for on #1208: the
// client compared paths with `===`, so a directory spelled another way walked straight past it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { rmDirRetrying, GIT_TEST_TIMEOUT_MS } from "../git/wtTestUtil.js";

const coreRows = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("../../../server/session/core-session-adapter.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/session/core-session-adapter.js")>()),
  coreSessions: { list: async () => coreRows },
}));

const { claimLaunch, worktreeOccupancy } = await import("../../../server/session/worktree-session-limit.js");
const { createWorktree, gitTopLevel } = await import("../../../server/git/worktrees.js");

const SESSION = "11111111-2222-3333-4444-555555555555";

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
  coreRows.length = 0;
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
  coreRows.length = 0;
  delete process.env.MULMOTERMINAL_HOME;
  rmDirRetrying(home);
  rmDirRetrying(repo);
});

const coreSession = (cwd: string, agent = "claude", attached = true) => ({
  id: SESSION,
  cwd,
  agent,
  attached,
  createdAt: new Date(),
  exited: false,
  exitCode: null,
  processId: 1,
  cols: 120,
  rows: 30,
  currentCommand: agent,
  title: null,
  memo: null,
});
const occupyWorktree = () => coreRows.push(coreSession(worktree));

describe.skipIf(!hasGit)("worktreeOccupancy", () => {
  it(
    "reports no session for a worktree nobody has started in",
    async () => {
      expect((await worktreeOccupancy(worktree)).session).toBeNull();
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it(
    "reports the session occupying the worktree",
    async () => {
      occupyWorktree();
      expect((await worktreeOccupancy(worktree)).session).toEqual({ id: SESSION, attached: true, agent: "claude" });
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
        expect((await worktreeOccupancy(alias)).session, alias).not.toBeNull();
      }
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // The limit is on WORKTREES. An ordinary repository takes as many terminals as the user wants —
  // that is what the grid is for, and refusing there would break the app's main use.
  it(
    "does not limit the repository itself",
    async () => {
      coreRows.push(coreSession(repo));
      expect((await worktreeOccupancy(repo)).isWorktree).toBe(false);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it(
    "does not limit a directory that is not a git repository at all",
    async () => {
      const plain = makeTempDir("wt-limit-plain-");
      try {
        expect(await worktreeOccupancy(plain)).toEqual({ isWorktree: false, session: null });
      } finally {
        rmDirRetrying(plain);
      }
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // Core cwd metadata is canonicalized, so alternate spellings do not evade occupancy.
  it(
    "finds a session started through a symlinked spelling of the worktree",
    async () => {
      const link = path.join(home, "link-to-worktree");
      try {
        symlinkSync(worktree, link, "junction");
      } catch {
        return; // Windows without the privilege to create one — the rule is the same, unobservable here
      }
      coreRows.push(coreSession(link, "codex"));
      expect((await worktreeOccupancy(worktree)).session).toEqual({ id: SESSION, attached: true, agent: "codex" });
      expect((await worktreeOccupancy(link)).session).toEqual({ id: SESSION, attached: true, agent: "codex" });
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // History is resumable agent data, not Terminal membership or worktree occupancy.
  it(
    "does not turn a history-only Claude conversation into occupancy",
    async () => {
      const link = path.join(home, "link-for-transcripts");
      try {
        symlinkSync(worktree, link, "junction");
      } catch {
        return; // Windows without the privilege to create one
      }
      const transcripts = path.join(home, "history-only");
      mkdirSync(transcripts, { recursive: true });
      writeFileSync(path.join(transcripts, `${SESSION}.jsonl`), "{}\n");
      try {
        expect((await worktreeOccupancy(link)).session).toBeNull();
      } finally {
        rmDirRetrying(transcripts);
      }
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // A shell parked in a worktree is a terminal someone opened, not an agent editing the tree.
  // dir-session.ts leaves it out, and so this must not refuse the worktree on the strength of one.
  it(
    "does not count a plain shell as the worktree's session",
    async () => {
      coreRows.push(coreSession(worktree, "shell"));
      expect((await worktreeOccupancy(worktree)).session).toBeNull();
    },
    GIT_TEST_TIMEOUT_MS,
  );
});

// Codex, third pass on #1208: the occupancy read is asynchronous, so two launches aimed at one
// worktree could both find it free and both spawn. The claim is what makes the check-and-start
// sequence atomic, and it has to be decided BEFORE anything awaits.
describe("claimLaunch", () => {
  // Every claim is released, because the count is module state — a leak here would show up as a
  // phantom contention in the next test rather than as a failure in this one.
  const claims: { release: () => void }[] = [];
  const claim = (dir: string) => {
    const held = claimLaunch(dir);
    claims.push(held);
    return held;
  };
  afterEach(() => {
    claims.splice(0).forEach((held) => held.release());
  });

  it("reports no contention for the first launch, and contention for one that overlaps it", () => {
    expect(claim("/wt/a").contended).toBe(false);
    expect(claim("/wt/a").contended).toBe(true);
  });

  it("is free again once the overlapping launches have finished", () => {
    claim("/wt/a").release();
    claim("/wt/a").release();
    expect(claim("/wt/a").contended).toBe(false);
  });

  it("keeps directories apart", () => {
    claim("/wt/a");
    expect(claim("/wt/b").contended).toBe(false);
  });

  // A counter, not a flag: the refused second launch releases on its way out, and that must not
  // cancel the first one's claim — which would let a THIRD launch through.
  it("does not let a released overlapping claim clear the one still running", () => {
    claim("/wt/a");
    claim("/wt/a").release();
    expect(claim("/wt/a").contended).toBe(true);
  });

  // Both the socket's close handler and an explicit release can call it.
  it("is idempotent", () => {
    const held = claim("/wt/a");
    held.release();
    held.release();
    expect(claim("/wt/a").contended).toBe(false);
  });

  // Same directory, different spelling — the race would otherwise be reopened by exactly the alias
  // problem the rest of this file exists for. `home` is a real directory, which is what canonical
  // resolution needs; it does not have to be a worktree for the key to be computed.
  it("sees two spellings of one directory as the same launch", () => {
    claim(home);
    expect(claim(`${home}${path.sep}`).contended).toBe(true);
    expect(claim(path.join(home, "..", path.basename(home))).contended).toBe(true);
  });
});
