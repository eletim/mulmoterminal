// @vitest-environment node
// GitLab's JSON turned into the session-scoped issue/MR metadata this app renders. The fixtures
// below were CAPTURED from gitlab.com (gitlab-org/cli, 2026-08-01) rather than written by hand.
import { describe, it, expect } from "vitest";
import { firstGlabMr, glabFirstMrUrl, glabIssueIsOpen, glabMrBody, glabMrPhase, glabNoteBodies } from "../../../server/git/glab-items.js";
import {
  glabIssueCloseArgs,
  glabMrCreateArgs,
  glabMrForBranchArgs,
  glabMrUpdateBodyArgs,
  glabMrViewArgs,
  glabIssueNoteArgs,
  glabIssueNotesArgs,
  glabIssueViewArgs,
  glabMrListArgs,
  glabTarget,
  type GlabTarget,
} from "../../../server/git/glab.js";
import { forgeFromRepoEntry } from "../../../server/git/forge-host.js";

// Built through the real chain rather than as an object literal: what `--repo` and `api` are given
// is decided by forge-host + glabTarget together, and a hand-made target would test neither.
const targetFor = (entry: string): GlabTarget => {
  const forge = forgeFromRepoEntry(entry);
  if (!forge) throw new Error(`not a repository entry: ${entry}`);
  return glabTarget(forge);
};

// The argv itself, because these flags do not mean what a reader of `gh` would assume and a wrong
// one produces a command that RUNS and returns the wrong thing (verified against glab 1.111.0).
describe("glab list arguments", () => {
  it("asks mr list for json with -F", () => {
    expect(glabMrListArgs(targetFor("gitlab.com/group/project"), 21)).toEqual([
      "mr",
      "list",
      "--repo",
      "https://gitlab.com/group/project",
      "--per-page",
      "21",
      "-F",
      "json",
    ]);
  });
});

describe("glabIssueViewArgs", () => {
  // `-F`, like `mr list` — and UNLIKE `issue list`, which takes `-O` and gives `-F` another
  // meaning. Three subcommands, three answers; `-O` here is rejected outright by glab.
  it("asks for json with -F", () => {
    expect(glabIssueViewArgs(targetFor("gitlab.com/group/project"), 7)).toEqual([
      "issue",
      "view",
      "7",
      "--repo",
      "https://gitlab.com/group/project",
      "-F",
      "json",
    ]);
  });
});

// Existing comments, for the duplicate check that keeps a work comment from being written twice.
// These shapes were read back from gitlab.com after posting a real note.
describe("glabNoteBodies", () => {
  const userNote = { id: 1, body: "started work in mulmoterminal4", system: false };
  // GitLab writes its own notes for closing, labelling, editing the description. They are not
  // comments anyone left — counting them would let a closed-once issue read as already commented.
  const systemNote = { id: 2, body: "closed", system: true };

  it("keeps what a person wrote and drops what GitLab wrote", () => {
    expect(glabNoteBodies([userNote, systemNote])).toEqual(["started work in mulmoterminal4"]);
  });

  it("treats a note with no system flag as a person's", () => {
    expect(glabNoteBodies([{ id: 3, body: "no flag here" }])).toEqual(["no flag here"]);
  });

  it.each([
    ["not an array", { notes: [] }],
    ["null", null],
  ])("is empty for %s", (_case, raw) => {
    expect(glabNoteBodies(raw)).toEqual([]);
  });

  it("survives a note with no body", () => {
    expect(glabNoteBodies([{ id: 4, system: false }])).toEqual([""]);
  });
});

describe("glabIssueIsOpen", () => {
  // GitLab spells it `opened`, lowercase — GitHub answers `OPEN`. Reading the wrong one would make
  // every issue look closed, and the merged comment would never close anything.
  it.each([
    ["opened", true],
    ["closed", false],
    ["OPEN", false],
  ])("reads state %s as open=%s", (state, open) => {
    expect(glabIssueIsOpen({ state })).toBe(open);
  });

  it("is false for something that is not an issue", () => {
    expect(glabIssueIsOpen("nope")).toBe(false);
  });
});

describe("glab issue write arguments", () => {
  // `note`, not `comment`. A reader who pattern-matched from `gh` would write the wrong verb, and
  // glab would reject it outright rather than doing something subtly different.
  it("comments with `note` and -m", () => {
    expect(glabIssueNoteArgs(targetFor("gitlab.com/group/project"), 7, "hello")).toEqual([
      "issue",
      "note",
      "7",
      "--repo",
      "https://gitlab.com/group/project",
      "-m",
      "hello",
    ]);
  });

  it("closes with the issue id", () => {
    expect(glabIssueCloseArgs(targetFor("gitlab.com/group/project"), 7)).toEqual(["issue", "close", "7", "--repo", "https://gitlab.com/group/project"]);
  });

  // The notes endpoint, because `issue view -F json` carries no comments. The project path is
  // percent-encoded: GitLab's REST API takes it as ONE path segment, so a group's slashes must not
  // read as segment separators.
  it("reads notes from the REST endpoint, with the project encoded", () => {
    expect(glabIssueNotesArgs(targetFor("gitlab.com/group/sub/project"), 7)).toEqual([
      "api",
      "--hostname",
      "gitlab.com",
      "projects/group%2Fsub%2Fproject/issues/7/notes",
      "--paginate",
    ]);
  });

  // Not a nicety. A page holds 20 notes, newest first, so one page drops the OLDEST — and the
  // work comment is written when work STARTS, which is the end that falls off. Without this the
  // duplicate check misses it and comments again (Codex review).
  it("always paginates, so an old comment on a long thread is still found", () => {
    expect(glabIssueNotesArgs(targetFor("gitlab.com/group/project"), 1)).toContain("--paginate");
  });
});

// The merge-request half of the ⧉ Open PR path. Shapes read back from a real MR on gitlab.com.
describe("glabMrBody", () => {
  it("takes the body from `description`", () => {
    expect(glabMrBody({ iid: 2, description: "Fixes #1\n\nwork in glreal" })).toBe("Fixes #1\n\nwork in glreal");
  });

  // A merge request with no description is ordinary — `--fill` leaves it empty when the commit has
  // no body. Reading it as a failure would skip appending the footer.
  it.each([
    ["an empty description", { iid: 2, description: "" }],
    ["no description at all", { iid: 2 }],
    ["something that is not an MR", "nope"],
  ])("is the empty string for %s", (_case, raw) => {
    expect(glabMrBody(raw)).toBe("");
  });
});

describe("glabFirstMrUrl", () => {
  it("takes the web_url of the first merge request", () => {
    expect(glabFirstMrUrl([{ iid: 2, web_url: "https://gitlab.com/o/p/-/merge_requests/2" }])).toBe("https://gitlab.com/o/p/-/merge_requests/2");
  });

  // An empty list is the ordinary "no merge request for this branch yet" answer, which is what
  // sends the caller on to the compare-page fallback rather than to an error.
  it.each([
    ["an empty list", []],
    ["not a list", { merge_requests: [] }],
    ["a row with no web_url", [{ iid: 2 }]],
  ])("is null for %s", (_case, raw) => {
    expect(glabFirstMrUrl(raw)).toBeNull();
  });
});

describe("glab merge-request arguments", () => {
  // No `--repo` anywhere: glab infers the project from the working directory, the same way `gh`
  // does — verified by running `glab mr list` in a directory holding nothing but a remote.
  it.each([
    ["create", glabMrCreateArgs("master", "issue/1-x")],
    ["forBranch", glabMrForBranchArgs("issue/1-x")],
    ["view", glabMrViewArgs("https://gitlab.com/o/p/-/merge_requests/2")],
    ["update", glabMrUpdateBodyArgs("https://gitlab.com/o/p/-/merge_requests/2", "body")],
  ])("%s passes no --repo", (_name, args) => {
    expect(args).not.toContain("--repo");
  });

  it("creates with the source and target branches named", () => {
    expect(glabMrCreateArgs("master", "issue/1-x")).toEqual(["mr", "create", "--fill", "--source-branch", "issue/1-x", "--target-branch", "master", "--yes"]);
  });

  // A URL is accepted wherever an iid is, which is what lets the body helpers keep taking the URL
  // they were handed rather than parsing an iid out of it.
  it("views and updates by whatever identifier it was given", () => {
    const url = "https://gitlab.com/o/p/-/merge_requests/2";
    expect(glabMrViewArgs(url)).toEqual(["mr", "view", url, "-F", "json"]);
    expect(glabMrUpdateBodyArgs(url, "b")).toEqual(["mr", "update", url, "--description", "b"]);
  });
});

// A merge request's phase. GitLab collapses into `detailed_merge_status` what GitHub splits three
// ways, and it is INDEPENDENT of the pipeline — observed on real merge requests, `success` with
// `not_approved` and `failed` with `not_approved` both occur.
describe("glabMrPhase", () => {
  const mr = (over: Record<string, unknown> = {}) => ({ state: "opened", draft: false, detailed_merge_status: "mergeable", ...over });

  it("is ready only when GitLab agrees it could merge", () => {
    expect(glabMrPhase(mr())).toEqual({ phase: "ready", blockedReason: null });
  });

  it.each([
    ["merged", "merged"],
    ["closed", "closed"],
  ])("reads the %s state before anything else", (state, phase) => {
    // Even with a blocker recorded: a merged request is not "waiting on approvals".
    expect(glabMrPhase(mr({ state, detailed_merge_status: "not_approved" }))).toEqual({ phase, blockedReason: null });
  });

  // The reason the field exists: three GitLab statuses have no home in `PrPhase`. Calling them
  // `ready` would name something unmergeable ready; the phase says "someone must act" and the
  // reason says what.
  it.each([
    ["not_approved", "waiting on approvals"],
    ["discussions_not_resolved", "unresolved discussions"],
    ["merge_request_blocked", "blocked by another merge request"],
    ["conflict", "conflicts with the target branch"],
  ])("keeps %s out of `ready` and explains it", (status, reason) => {
    expect(glabMrPhase(mr({ detailed_merge_status: status }))).toEqual({ phase: "changes-requested", blockedReason: reason });
  });

  // `ready` ONLY when GitLab says `mergeable`. A status we have no phrase for is still a status
  // GitLab is reporting INSTEAD of mergeable, so calling it ready is a green pill on a merge
  // request that cannot merge — the one direction of error that matters (Codex review).
  // Two things at once, and an earlier revision of this PR got each of them wrong in turn.
  // NOT ready: GitLab named something other than `mergeable`, so a green pill would be false.
  // NOT explained either: `detailed_merge_status` is GitLab's internal vocabulary, and putting an
  // unrecognised one in a tooltip shows a reader a raw backend identifier (Codex review, twice).
  it("neither calls an unrecognised status ready nor prints it", () => {
    expect(glabMrPhase(mr({ detailed_merge_status: "some_new_status" }))).toEqual({ phase: "changes-requested", blockedReason: null });
  });

  // The case Codex named. `ci_must_pass` means CI is what is holding the merge — and a LIST row
  // never carries `head_pipeline`, which is exactly the fallback path taken when `mr view` fails.
  it("reads ci_must_pass as CI running even with no pipeline field at all", () => {
    expect(glabMrPhase({ state: "opened", draft: false, detailed_merge_status: "ci_must_pass" })).toEqual({
      phase: "ci-running",
      blockedReason: "waiting on CI",
    });
  });

  // Draft is the author's own "not yet", which outranks whatever the project is waiting on — the
  // same order `derivePrPhase` uses for GitHub.
  it("reports a draft as draft, while still carrying the reason", () => {
    expect(glabMrPhase(mr({ draft: true, detailed_merge_status: "not_approved" }))).toEqual({ phase: "draft", blockedReason: "waiting on approvals" });
  });

  it.each([
    ["failed", "ci-failing"],
    ["canceled", "ci-failing"],
    ["running", "ci-running"],
    ["pending", "ci-running"],
  ])("reads a %s pipeline as %s", (status, phase) => {
    expect(glabMrPhase(mr({ head_pipeline: { status } })).phase).toBe(phase);
  });

  // The pipeline is independent of the merge status, so a green pipeline does NOT make an
  // unapproved request ready.
  it("does not let a green pipeline override an outstanding approval", () => {
    expect(glabMrPhase(mr({ head_pipeline: { status: "success" }, detailed_merge_status: "not_approved" }))).toEqual({
      phase: "changes-requested",
      blockedReason: "waiting on approvals",
    });
  });

  it("is `none` for something that is not a merge request", () => {
    expect(glabMrPhase("nope")).toEqual({ phase: "none", blockedReason: null });
  });
});

describe("firstGlabMr", () => {
  it("takes the iid, url and title of the first row", () => {
    const row = { iid: 3, web_url: "https://gitlab.com/o/p/-/merge_requests/3", title: "a change" };
    expect(firstGlabMr([row])).toMatchObject({ iid: 3, url: "https://gitlab.com/o/p/-/merge_requests/3", title: "a change" });
  });

  // The row itself rides along so a failed detail read can still answer from what the list knew.
  it("carries the row so a failed detail read can fall back to it", () => {
    const row = { iid: 3, web_url: "u", title: "t", detailed_merge_status: "not_approved" };
    expect(glabMrPhase(firstGlabMr([row])?.raw).blockedReason).toBe("waiting on approvals");
  });

  it.each([
    ["an empty list", []],
    ["not a list", {}],
    ["a row with no iid", [{ web_url: "u" }]],
  ])("is null for %s", (_case, raw) => {
    expect(firstGlabMr(raw)).toBeNull();
  });
});
