// GitLab's JSON turned into the rows this app already renders. The two fixtures below were
// CAPTURED from gitlab.com (gitlab-org/cli, 2026-08-01) rather than written by hand, so a field
// GitLab renames breaks this instead of quietly emptying a row.
import { describe, it, expect } from "vitest";
import { normalizeGlabIssue, normalizeGlabMr } from "../../../server/git/glab-items.js";
import { glabIssueListArgs, glabMrListArgs } from "../../../server/git/glab.js";

const REAL_MR = {
  iid: 3675,
  title: "fix(ci): highlight the focused modal button",
  updated_at: "2026-08-01T11:15:58.201Z",
  web_url: "https://gitlab.com/gitlab-org/cli/-/merge_requests/3675",
  draft: false,
  detailed_merge_status: "not_approved",
  state: "opened",
  author: { username: "samuelfirst1" },
};

const REAL_ISSUE = {
  iid: 8484,
  title: 'glab_1.111.0_Windows_x86_64_installer.exe: uses "Program Files (x86)" install prefix.',
  updated_at: "2026-08-01T16:10:24.082Z",
  web_url: "https://gitlab.com/gitlab-org/cli/-/work_items/8484",
  state: "opened",
  author: { username: "St0fF-NPL-ToM" },
};

describe("normalizeGlabIssue", () => {
  it("maps a real GitLab issue onto the shared row", () => {
    expect(normalizeGlabIssue(REAL_ISSUE)).toEqual({
      number: 8484,
      title: 'glab_1.111.0_Windows_x86_64_installer.exe: uses "Program Files (x86)" install prefix.',
      author: "St0fF-NPL-ToM",
      updatedAt: "2026-08-01T16:10:24.082Z",
      // Taken as given: GitLab is moving issues to `/-/work_items/`, and it already answers with
      // that path. A URL composed here would point at the older one.
      url: "https://gitlab.com/gitlab-org/cli/-/work_items/8484",
    });
  });

  // `id` is unique across the whole instance; `iid` is the number the UI and the URL show. Reading
  // the wrong one produces rows whose numbers match nothing a user can look up.
  it("numbers the row from iid, not id", () => {
    expect(normalizeGlabIssue({ ...REAL_ISSUE, id: 999999 })?.number).toBe(8484);
  });

  it.each([
    ["a non-object", "nope"],
    ["no iid", { ...REAL_ISSUE, iid: undefined }],
    ["a non-integer iid", { ...REAL_ISSUE, iid: 1.5 }],
    ["no web_url", { ...REAL_ISSUE, web_url: "" }],
  ])("drops a row with %s", (_case, raw) => {
    expect(normalizeGlabIssue(raw)).toBeNull();
  });

  it("survives a missing author rather than dropping the row", () => {
    expect(normalizeGlabIssue({ ...REAL_ISSUE, author: null })?.author).toBe("");
  });
});

describe("normalizeGlabMr", () => {
  it("maps a real merge request onto the shared row", () => {
    expect(normalizeGlabMr(REAL_MR)).toEqual({
      number: 3675,
      title: "fix(ci): highlight the focused modal button",
      author: "samuelfirst1",
      updatedAt: "2026-08-01T11:15:58.201Z",
      url: "https://gitlab.com/gitlab-org/cli/-/merge_requests/3675",
      isDraft: false,
      review: "REVIEW_REQUIRED",
      ci: "none",
    });
  });

  // Only the statuses that genuinely mean the same thing are mapped. The rest leave `review` empty
  // rather than inventing a GitHub verdict for a GitLab state — `discussions_not_resolved` is not
  // "changes requested", and `mergeable` is not "approved" on a project that requires no approvals.
  it.each([
    ["requested_changes", "CHANGES_REQUESTED"],
    ["not_approved", "REVIEW_REQUIRED"],
    ["mergeable", null],
    ["discussions_not_resolved", null],
    ["merge_request_blocked", null],
    ["unchecked", null],
    ["conflict", null],
    ["draft_status", null],
  ])("maps detailed_merge_status %s to review %s", (status, review) => {
    expect(normalizeGlabMr({ ...REAL_MR, detailed_merge_status: status })?.review).toBe(review);
  });

  // The list endpoint carries no pipeline at all, and `CiState` is GitHub's vocabulary, left
  // untouched — so a GitLab row says no more than a GitHub one can. `ci_must_pass` is the single
  // status that names CI as the blocker; everything else falls back to the same `none` a GitHub
  // row with no checks carries.
  it.each([
    ["ci_must_pass", "pending"],
    ["mergeable", "none"],
    ["not_approved", "none"],
    ["unchecked", "none"],
  ])("reports CI for %s as %s", (status, ci) => {
    expect(normalizeGlabMr({ ...REAL_MR, detailed_merge_status: status })?.ci).toBe(ci);
  });

  // `draft` is its own boolean, so the title prefix never has to be parsed.
  it.each([
    [true, true],
    [false, false],
  ])("reads draft: %s from the field, not the title", (draft, expected) => {
    expect(normalizeGlabMr({ ...REAL_MR, draft, title: "Draft: something" })?.isDraft).toBe(expected);
  });

  it("drops a merge request it cannot number", () => {
    expect(normalizeGlabMr({ ...REAL_MR, iid: undefined })).toBeNull();
  });
});

// The argv itself, because these flags do not mean what a reader of `gh` would assume and a wrong
// one produces a command that RUNS and returns the wrong thing (verified against glab 1.111.0).
describe("glab list arguments", () => {
  it("asks mr list for json with -F", () => {
    expect(glabMrListArgs("group/project", 21)).toEqual(["mr", "list", "--repo", "group/project", "--per-page", "21", "-F", "json"]);
  });

  // `-F` on `issue list` is `--output-format` (details|ids|urls), NOT the output format — that is
  // `-O`. The same short flag, a different meaning, one subcommand apart.
  //
  // No state flag: `--opened` exists but is deprecated, and running it prints a warning saying the
  // open list is the default. Passing it would add noise now and break later.
  it("asks issue list for json with -O, and passes no state flag", () => {
    expect(glabIssueListArgs("group/project", 21)).toEqual(["issue", "list", "--repo", "group/project", "--per-page", "21", "-O", "json"]);
  });
});
