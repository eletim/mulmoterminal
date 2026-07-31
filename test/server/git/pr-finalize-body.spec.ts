import { describe, it, expect, vi, afterEach } from "vitest";
import { appendWorkdirFooter, type Runner } from "../../../server/git/worktree-pr.js";
import type { SpawnResult } from "../../../server/git/spawn-collect.js";

const PR_URL = "https://github.com/acme/web/pull/42";
const REPO_ROOT = "/Users/u/ss/llm/mulmoclaude3";
const FOOTER = "work in mulmoclaude3";

const ok = (stdout: string): SpawnResult => ({ ok: true, stdout, stderr: "" });
const failed = (stderr: string): SpawnResult => ({ ok: false, stdout: "", stderr });

// A Runner that answers `gh pr view` with `body` and records every call.
function fakeRunner(view: SpawnResult, edit: SpawnResult = ok("")) {
  const calls: { args: string[] }[] = [];
  const runner: Runner = (_cmd, args) => {
    calls.push({ args });
    return Promise.resolve(args[1] === "view" ? view : edit);
  };
  return { runner, calls };
}

const editCallOf = (calls: { args: string[] }[]) => calls.find((c) => c.args[1] === "edit");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("appendWorkdirFooter", () => {
  it("edits the PR body to end with the clone name", async () => {
    const { runner, calls } = fakeRunner(ok("Fixes the login bug.\n"));
    await appendWorkdirFooter(PR_URL, REPO_ROOT, "/cwd", runner);
    expect(editCallOf(calls)?.args).toEqual(["pr", "edit", PR_URL, "--body", `Fixes the login bug.\n\n${FOOTER}`]);
  });

  // The body has to be READ first: `--body` on `gh pr create` replaces what `--fill` derived
  // from the commits, so the append cannot be folded into the create call.
  it("reads the body before writing it", async () => {
    const { runner, calls } = fakeRunner(ok("Fixes the login bug.\n"));
    await appendWorkdirFooter(PR_URL, REPO_ROOT, "/cwd", runner);
    expect(calls[0].args).toEqual(["pr", "view", PR_URL, "--json", "body", "--jq", ".body"]);
  });

  it("writes nothing when the line is already there", async () => {
    const { runner, calls } = fakeRunner(ok(`Fixes the login bug.\n\n${FOOTER}`));
    await appendWorkdirFooter(PR_URL, REPO_ROOT, "/cwd", runner);
    expect(editCallOf(calls)).toBeUndefined();
  });

  // Both halves run AFTER the PR exists. Throwing here would surface as "the PR failed" for
  // a PR that was created — the worst possible report.
  it("does not throw when the body cannot be read, and does not guess at an edit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runner, calls } = fakeRunner(failed("gh: not authenticated"));
    await expect(appendWorkdirFooter(PR_URL, REPO_ROOT, "/cwd", runner)).resolves.toBeUndefined();
    expect(editCallOf(calls)).toBeUndefined();
  });

  it("does not throw when the edit itself fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runner } = fakeRunner(ok("Fixes the login bug.\n"), failed("network error"));
    await expect(appendWorkdirFooter(PR_URL, REPO_ROOT, "/cwd", runner)).resolves.toBeUndefined();
  });

  it("says which PR and which line when it gives up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runner } = fakeRunner(failed("gh: not authenticated"));
    await appendWorkdirFooter(PR_URL, REPO_ROOT, "/cwd", runner);
    expect(warn.mock.calls[0][0]).toContain(PR_URL);
    expect(warn.mock.calls[0][0]).toContain(FOOTER);
  });

  it("becomes the whole body when the commits produced none", async () => {
    const { runner, calls } = fakeRunner(ok(""));
    await appendWorkdirFooter(PR_URL, REPO_ROOT, "/cwd", runner);
    expect(editCallOf(calls)?.args[4]).toBe(FOOTER);
  });
});
