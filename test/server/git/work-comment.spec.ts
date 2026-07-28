// @vitest-environment node
// Leaving a comment on an issue, exactly once, from a caller that asks on every poll of every
// open tab (#979 Phase 2). Everything here is about that "exactly once": what the marker is, when
// the thread already answers the question, and what the process memo saves.
import { describe, it, expect, beforeEach } from "vitest";
import { ensureWorkComment, clearWorkCommentMemo } from "../../../server/git/work-comment";
import { alreadyCommented, workCommentBody, workCommentDirLabel, workCommentMarker } from "../../../common/workComment";

const issueView = (bodies: string[], state = "OPEN") => JSON.stringify({ state, comments: bodies.map((body) => ({ body })) });

// A `gh` stand-in that records what it was asked to do.
function fakeGh(view: string, opts: { commentOk?: boolean; closeOk?: boolean; viewOk?: boolean } = {}) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[1] === "view") return { ok: opts.viewOk ?? true, stdout: view, stderr: "" };
    if (args[1] === "comment") return { ok: opts.commentOk ?? true, stdout: "", stderr: "" };
    return { ok: opts.closeOk ?? true, stdout: "", stderr: "" };
  };
  const did = (verb: string) => calls.filter((c) => c[1] === verb).length;
  return { run, calls, did };
}

beforeEach(() => clearWorkCommentMemo());

describe("workCommentDirLabel", () => {
  it.each([
    ["/Users/me/ss/llm/mulmoterminal5", "mulmoterminal5"],
    ["/Users/me/ss/llm/mulmoterminal5/", "mulmoterminal5"],
    ["C:\\work\\acme-web", "acme-web"],
    ["mulmoclaude4", "mulmoclaude4"],
  ])("names %s as %s", (cwd, expected) => {
    expect(workCommentDirLabel(cwd)).toBe(expected);
  });

  // The reason it is the basename: the comment lands on a public issue.
  it("never carries the path above the directory", () => {
    expect(workCommentDirLabel("/Users/someone/private-client/secret-project")).toBe("secret-project");
  });
});

describe("workCommentBody", () => {
  it("says where the work is happening and carries its marker", () => {
    const body = workCommentBody("start", "mulmoterminal5", null);
    expect(body).toContain("`mulmoterminal5`");
    expect(body).toContain(workCommentMarker("start", "mulmoterminal5"));
  });

  it("names the PR the merge came in as", () => {
    expect(workCommentBody("merged", "mulmoterminal5", 983)).toContain("#983");
  });

  it("still reads as a sentence with no PR number", () => {
    expect(workCommentBody("merged", "mulmoterminal5", null)).toContain("Merged.");
  });
});

describe("alreadyCommented", () => {
  const dir = "mulmoterminal5";

  it("finds its own marker in a thread of other comments", () => {
    expect(alreadyCommented(["LGTM", workCommentBody("start", dir, null), "thanks"], "start", dir)).toBe(true);
  });

  it("does not confuse the two kinds", () => {
    expect(alreadyCommented([workCommentBody("start", dir, null)], "merged", dir)).toBe(false);
  });

  // A second clone working the same issue is a second honest line, not a duplicate.
  it("does not confuse two directories", () => {
    expect(alreadyCommented([workCommentBody("start", "mulmoterminal2", null)], "start", dir)).toBe(false);
  });

  it("says no for an empty thread", () => {
    expect(alreadyCommented([], "start", dir)).toBe(false);
  });
});

describe("ensureWorkComment", () => {
  it("writes the comment when the thread has none", async () => {
    const gh = fakeGh(issueView(["unrelated"]));
    const result = await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run });
    expect(result.posted).toBe(true);
    expect(gh.did("comment")).toBe(1);
    expect(gh.calls.find((c) => c[1] === "comment")?.join(" ")).toContain("mulmoterminal:work:start");
  });

  // The property the whole module exists for.
  it("writes once however many times it is asked", async () => {
    const gh = fakeGh(issueView([]));
    await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run });
    await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run });
    await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run });
    expect(gh.did("comment")).toBe(1);
    expect(gh.did("view")).toBe(1); // the memo also spares gh the repeat lookups
  });

  // A restarted server has an empty memo; the thread is what stops it.
  it("stays quiet when a previous process already said it", async () => {
    const gh = fakeGh(issueView([workCommentBody("start", "mulmoterminal5", null)]));
    const result = await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run });
    expect(result).toEqual({ posted: false, reason: "already" });
    expect(gh.did("comment")).toBe(0);
  });

  it("treats another directory's comment as somebody else's", async () => {
    const gh = fakeGh(issueView([workCommentBody("start", "mulmoterminal2", null)]));
    expect((await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run })).posted).toBe(true);
  });

  it("closes a still-open issue on merge", async () => {
    const gh = fakeGh(issueView([], "OPEN"));
    const result = await ensureWorkComment("o/r", 966, "merged", "mulmoterminal5", 983, { runGh: gh.run, closeIssue: true });
    expect(result).toEqual({ posted: true, closed: true });
    expect(gh.did("close")).toBe(1);
  });

  // `Fixes #N` means GitHub already closed it; asking again is noise on the timeline.
  it("does not close an issue GitHub already closed", async () => {
    const gh = fakeGh(issueView([], "CLOSED"));
    const result = await ensureWorkComment("o/r", 966, "merged", "mulmoterminal5", 983, { runGh: gh.run, closeIssue: true });
    expect(result).toEqual({ posted: true, closed: false });
    expect(gh.did("close")).toBe(0);
  });

  it("does not close on the start comment", async () => {
    const gh = fakeGh(issueView([], "OPEN"));
    await ensureWorkComment("o/r", 966, "start", "mulmoterminal5", null, { runGh: gh.run });
    expect(gh.did("close")).toBe(0);
  });

  // gh missing, not logged in, no network: say nothing and stay retryable — the memo must NOT
  // record a failure as done.
  it("reports a failed lookup without remembering it", async () => {
    const failing = fakeGh("", { viewOk: false });
    expect(await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: failing.run })).toEqual({ posted: false, reason: "gh-failed" });
    const working = fakeGh(issueView([]));
    expect((await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: working.run })).posted).toBe(true);
  });

  it("reports a failed write without remembering it", async () => {
    const failing = fakeGh(issueView([]), { commentOk: false });
    expect(await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: failing.run })).toEqual({ posted: false, reason: "gh-failed" });
    const working = fakeGh(issueView([]));
    expect((await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: working.run })).posted).toBe(true);
  });

  it("keeps a failed close from failing the comment", async () => {
    const gh = fakeGh(issueView([], "OPEN"), { closeOk: false });
    expect(await ensureWorkComment("o/r", 966, "merged", "d", 1, { runGh: gh.run, closeIssue: true })).toEqual({ posted: true, closed: false });
  });

  it("survives a garbled issue view", async () => {
    const gh = fakeGh("not json");
    expect(await ensureWorkComment("o/r", 966, "start", "d", null, { runGh: gh.run })).toEqual({ posted: false, reason: "gh-failed" });
  });
});
