// @vitest-environment node
// The phone's issue commands (#1184). The case that matters most is the one the protocol makes a
// rule of: the phone never sends a path, so the directory the work starts in comes from the
// RECORDED clone — and when there is no answer to that, nothing starts at all.
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RepoDirs } from "../../../common/repoDirs.js";
import type { RepoIssues } from "../../../common/ghItems.js";

const config = { prRepos: ["acme/web"] };
vi.mock("../../config/config-routes.js", () => ({
  getPrRepos: () => config.prRepos,
  getCwdPresets: () => [],
  getRepoDirs: () => ({}),
}));

// The repo -> clone answer is this suite's INPUT (repo-dirs.spec.ts covers how it is resolved), so
// it is stubbed rather than built out of real clones on disk.
const dirs: { rows: RepoDirs[] } = { rows: [] };
vi.mock("../../git/repo-dirs.js", () => ({ repoDirsFromPresets: async () => dirs.rows }));

const issues: { rows: RepoIssues[] } = { rows: [] };
vi.mock("../../git/issues.js", () => ({ listIssuesAcrossRepos: async () => issues.rows }));

const issueWork = { start: vi.fn() };
vi.mock("../../git/issue-work.js", () => ({
  startIssueWork: (...args: unknown[]) => issueWork.start(...args),
}));

const { createIssueWorkHandlers } = await import("./handlers/issueWork.js");

const clone = (path: string, label = path): RepoDirs["dirs"][number] => ({ path, label, orderPriority: null });
const repoDirs = (paths: string[], primary: string | null = null, repo = "acme/web"): RepoDirs => ({ repo, dirs: paths.map((p) => clone(p)), primary });

const spawnIssueDraft = vi.fn<(cwd: string, draft: string) => string>();
const handlers = createIssueWorkHandlers({ spawnIssueDraft });

const start = (params: Record<string, unknown>) => handlers.startIssueWork({ ...params } as Parameters<(typeof handlers)["startIssueWork"]>[0]);
const list = () => handlers.listIssues({});

describe("startIssueWork (phone)", () => {
  beforeEach(() => {
    spawnIssueDraft.mockReset();
    spawnIssueDraft.mockReturnValue("s-1");
    issueWork.start.mockReset();
    issueWork.start.mockResolvedValue({ ok: true, sessionId: "s-1", branch: "issue/7-thing", worktree: "/wt/thing", issue: { number: 7, title: "The thing" } });
    dirs.rows = [repoDirs(["/clones/web"], "/clones/web")];
    issues.rows = [];
    config.prRepos = ["acme/web"];
  });

  it("starts in the recorded clone and answers with the session and branch", async () => {
    const answer = await start({ repo: "acme/web", issue: 7 });
    expect(issueWork.start).toHaveBeenCalledWith("acme/web", 7, "/clones/web", expect.anything());
    expect(answer).toMatchObject({ started: true, sessionId: "s-1", branch: "issue/7-thing", issue: { number: 7, title: "The thing" } });
  });

  // The protocol rule itself. A `dir` the phone sends must not reach the filesystem, and the way
  // to be sure of that is that sending one changes nothing about where the work starts.
  it("ignores a dir the caller sends and uses the recorded clone", async () => {
    dirs.rows = [repoDirs(["/clones/web", "/clones/web2"], "/clones/web")];
    await start({ repo: "acme/web", issue: 7, dir: "/etc" });
    expect(issueWork.start).toHaveBeenCalledWith("acme/web", 7, "/clones/web", expect.anything());
  });

  it("starts in the only clone when the repo has one and nothing was recorded", async () => {
    dirs.rows = [repoDirs(["/clones/web"])];
    await start({ repo: "acme/web", issue: 7 });
    expect(issueWork.start).toHaveBeenCalledWith("acme/web", 7, "/clones/web", expect.anything());
  });

  it("refuses when several clones could host the work and none is recorded, and starts nothing", async () => {
    dirs.rows = [repoDirs(["/clones/web", "/clones/web2"])];
    await expect(start({ repo: "acme/web", issue: 7 })).rejects.toThrow(/several clones.*desktop/s);
    expect(issueWork.start).not.toHaveBeenCalled();
  });

  it("refuses a repo with no clone on this machine, and starts nothing", async () => {
    dirs.rows = [];
    await expect(start({ repo: "acme/web", issue: 7 })).rejects.toThrow(/No local clone of acme\/web/);
    expect(issueWork.start).not.toHaveBeenCalled();
  });

  // A recording keyed `Acme/Web` and an entry named `acme/web` are the same repository — the two
  // spellings reach the host from different places (hand-typed config vs. the remote URL).
  it("matches the repo case-insensitively", async () => {
    await start({ repo: "Acme/Web", issue: 7 });
    expect(issueWork.start).toHaveBeenCalledWith("Acme/Web", 7, "/clones/web", expect.anything());
  });

  it.each([
    ["a repo that is not owner/repo", { repo: "no-slash", issue: 7 }],
    ["a missing repo", { issue: 7 }],
    ["a missing issue number", { repo: "acme/web" }],
    ["issue zero", { repo: "acme/web", issue: 0 }],
    ["a non-integer issue", { repo: "acme/web", issue: 1.5 }],
    ["an issue sent as a string", { repo: "acme/web", issue: "7" }],
  ])("rejects %s without starting anything", async (_case, params) => {
    await expect(start(params)).rejects.toThrow();
    expect(issueWork.start).not.toHaveBeenCalled();
  });

  // The reason a step failed is the sentence the phone shows, so it has to survive the trip.
  it("surfaces the reason the work could not be started", async () => {
    issueWork.start.mockResolvedValue({ ok: false, reason: "issue-not-found", detail: "could not read acme/web#7" });
    await expect(start({ repo: "acme/web", issue: 7 })).rejects.toThrow("could not read acme/web#7");
  });

  // #1219. The phone has no launcher row to resume from, so the sentence about the worktree being
  // held is the whole of what it can show — it has to arrive intact rather than as a generic fail.
  it("passes on the refusal when the issue's worktree is held by another terminal", async () => {
    issueWork.start.mockResolvedValue({
      ok: false,
      reason: "worktree-busy",
      detail: "this worktree's session is open in another terminal — close it there first",
    });
    await expect(start({ repo: "acme/web", issue: 7 })).rejects.toThrow(/open in another terminal/);
  });

  // A second tap on an issue already being worked on opens THAT session; the phone must be able to
  // tell, because nothing is waiting in its input box.
  it("tells the phone which of the three things happened", async () => {
    issueWork.start.mockResolvedValue({ ok: true, outcome: "resumed", sessionId: "s-old", branch: "issue/7-thing" });
    await expect(start({ repo: "acme/web", issue: 7 })).resolves.toMatchObject({ outcome: "resumed", sessionId: "s-old" });
  });

  // An older result with no outcome reads as the ordinary case rather than as a missing key the
  // phone has to special-case.
  it("defaults the outcome to created", async () => {
    await expect(start({ repo: "acme/web", issue: 7 })).resolves.toMatchObject({ outcome: "created" });
  });

  it("passes the spawner through, so the session is the one the host started", async () => {
    issueWork.start.mockImplementation(async (_repo: string, _issue: number, _dir: string, deps: { spawnDraft: (cwd: string, draft: string) => string }) => ({
      ok: true,
      sessionId: deps.spawnDraft("/wt/thing", "GitHub issue #7"),
      branch: "issue/7-thing",
    }));
    const answer = await start({ repo: "acme/web", issue: 7 });
    expect(spawnIssueDraft).toHaveBeenCalledWith("/wt/thing", "GitHub issue #7");
    expect(answer).toMatchObject({ sessionId: "s-1" });
  });
});

describe("listIssues (phone)", () => {
  beforeEach(() => {
    issues.rows = [
      {
        repo: "acme/web",
        issues: [{ number: 7, title: "The thing", author: "isamu", updatedAt: "2026-08-01T00:00:00Z", url: "https://github.com/acme/web/issues/7" }],
      },
    ];
    dirs.rows = [repoDirs(["/clones/web"], "/clones/web")];
  });

  it("answers the configured repos' issues, marked as startable", async () => {
    const answer = await list();
    expect(answer).toMatchObject({ repos: [{ repo: "acme/web", canStart: true, issues: [{ number: 7, title: "The thing" }] }] });
    // Absent, not empty: the phone renders a reason it is given, so "" would be a reason nobody wrote.
    expect(Object.keys((answer as { repos: object[] }).repos[0])).not.toContain("startBlocked");
  });

  it("marks a repo whose clone has not been chosen as not startable, with the reason", async () => {
    dirs.rows = [repoDirs(["/clones/web", "/clones/web2"])];
    const answer = await list();
    expect(answer).toMatchObject({ repos: [{ repo: "acme/web", canStart: false, startBlocked: expect.stringMatching(/several clones/) }] });
  });

  it("marks a repo with no clone here as not startable, with the reason", async () => {
    dirs.rows = [];
    const answer = await list();
    expect(answer).toMatchObject({ repos: [{ repo: "acme/web", canStart: false, startBlocked: expect.stringMatching(/No local clone/) }] });
  });

  // A repo whose `gh issue list` failed still has to come back — the phone shows the per-repo error
  // rather than dropping the repo, exactly as the desktop list does.
  it("keeps a repo that could not be read, error and all", async () => {
    issues.rows = [{ repo: "acme/web", error: "gh issue list failed" }];
    const answer = await list();
    expect(answer).toMatchObject({ repos: [{ repo: "acme/web", error: "gh issue list failed", canStart: true }] });
  });
});
