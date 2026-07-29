// Which issue a cell is working on is guessed from two places, and both guesses are shown to the
// user as a number they can click. A wrong guess is worse than none — it points at somebody
// else's issue — so the rules are pinned here rather than left to the regexes.
import { describe, it, expect } from "vitest";
import { issueRefFromPrBody, issueCandidateFromBranch, isPrPhase, EMPTY_WORK_ITEM } from "../../common/prPhase";

describe("issueRefFromPrBody", () => {
  it.each([
    ["Fixes #966", 966],
    ["fixes #966", 966],
    ["Fixed #966", 966],
    ["Fix #966", 966],
    ["Closes #12", 12],
    ["closed #12", 12],
    ["Close #12", 12],
    ["Resolves #7", 7],
    ["resolved #7", 7],
    ["Resolve #7", 7],
    ["Fixes: #966", 966],
    ["## Summary\n\nblah blah\n\nFixes #966\n\n## Tests", 966],
  ])("reads %j as issue %i", (body, expected) => {
    expect(issueRefFromPrBody(body)).toBe(expected);
  });

  it("takes the first when a body closes several", () => {
    expect(issueRefFromPrBody("Fixes #10\nFixes #11")).toBe(10);
  });

  it.each([
    ["a bare mention", "related to #12"],
    ["a keyword with no number", "Fixes the scrollbar"],
    ["a word that merely contains one", "Prefixes #12 with a slash"],
    ["no body at all", ""],
    ["null", null],
    ["undefined", undefined],
  ])("does not invent an issue from %s", (_label, body) => {
    expect(issueRefFromPrBody(body)).toBeNull();
  });

  // A full URL can name another repository, and the number is rendered as THIS repo's issue.
  it("ignores the full-URL form, which may point at another repo", () => {
    expect(issueRefFromPrBody("Fixes https://github.com/other/repo/issues/12")).toBeNull();
  });

  // Boundaries (found by Codex review). A typo must not become a link: there is no issue #0,
  // "#0123" is not issue 123, and 20 digits parse to 1e20 — which would render as "#1e+20".
  it.each([
    ["zero", "Fixes #0"],
    ["a leading zero", "Fixes #0123"],
    ["more digits than a number can hold exactly", `Fixes #${"9".repeat(20)}`],
  ])("declines %s", (_label, body) => {
    expect(issueRefFromPrBody(body)).toBeNull();
  });

  it("still reads the largest issue number that stays exact", () => {
    expect(issueRefFromPrBody(`Fixes #${Number.MAX_SAFE_INTEGER}`)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("issueCandidateFromBranch", () => {
  it.each([
    ["fix/966-preserve-unknown-config-keys", 966],
    ["feat/910-phase3-external-changes", 910],
    ["docs/7-typo", 7],
    ["fix/955-node-env-leak", 955],
  ])("reads %s as issue %i", (branch, expected) => {
    expect(issueCandidateFromBranch(branch)).toBe(expected);
  });

  // The reason the shape is constrained at all: this branch really exists in this repo, and
  // "#20260728" would be a link to nothing presented as the issue being worked on.
  it("does not read a trailing date as an issue number", () => {
    expect(issueCandidateFromBranch("chore/dep-updates-20260728")).toBeNull();
  });

  // ...but the shape alone cannot go further: a year sitting where an issue number goes is
  // indistinguishable from an issue number. This is why the result is a candidate and the caller
  // has to confirm the issue exists — the regex is not allowed to be the last word.
  it("cannot tell a leading year from an issue number, which is why it only offers a candidate", () => {
    expect(issueCandidateFromBranch("release/2026-07-28-hotfix")).toBe(2026);
  });

  it.each([
    ["main", "main"],
    ["no type prefix", "966-fix-something"],
    ["digits not at the front of the name", "fix/x-966"],
    ["no hyphen after the digits", "fix/966"],
    ["a leading zero", "fix/0966-x"],
    ["zero itself", "fix/0-x"],
    ["more digits than a number can hold exactly", `fix/${"9".repeat(20)}-x`],
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
  ])("declines %s", (_label, branch) => {
    expect(issueCandidateFromBranch(branch)).toBeNull();
  });
});

describe("isPrPhase", () => {
  it("accepts every phase the server can send", () => {
    ["none", "draft", "ci-failing", "changes-requested", "ci-running", "ready", "merged", "closed"].forEach((p) => expect(isPrPhase(p), p).toBe(true));
  });

  it.each([["unknown"], [""], [null], [undefined], [3], [{}]])("rejects %j", (v) => {
    expect(isPrPhase(v)).toBe(false);
  });
});

describe("EMPTY_WORK_ITEM", () => {
  it("is the nothing-to-show shape", () => {
    expect(EMPTY_WORK_ITEM).toEqual({ phase: "none", pr: null, prUrl: null, issue: null, issueUrl: null, prTitle: null, issueTitle: null });
  });
});
