// @vitest-environment node
// What the phone is told about a session's work (#1014). The phone has one line of room, so the
// decisions worth pinning are which title wins and when there is nothing worth sending at all.
import { describe, it, expect } from "vitest";
import { sessionWorkSummary } from "../../../server/mobileTerminal/terminalScreen";
import { workItemHeadline, EMPTY_WORK_ITEM, type WorkItem } from "../../../common/prPhase";

const item = (over: Partial<WorkItem> = {}): WorkItem => ({ ...EMPTY_WORK_ITEM, ...over });

describe("workItemHeadline", () => {
  // What the work is FOR beats what was done about it: on a phone the issue's title is the one
  // that answers "which request is this".
  it("prefers the issue's title", () => {
    expect(workItemHeadline(item({ issueTitle: "the report", prTitle: "the change" }))).toBe("the report");
  });

  it("falls back to the PR's title", () => {
    expect(workItemHeadline(item({ prTitle: "the change" }))).toBe("the change");
  });

  it("has nothing to say when neither has a title", () => {
    expect(workItemHeadline(item({ pr: 3, issue: 4 }))).toBeNull();
  });
});

describe("sessionWorkSummary", () => {
  it("sends the numbers, the phase and one line of words", () => {
    const summary = sessionWorkSummary(item({ phase: "ready", pr: 987, issue: 979, issueTitle: "show the work item on the phone" }));
    expect(summary).toEqual({ pr: 987, issue: 979, phase: "ready", headline: "show the work item on the phone" });
  });

  it("sends an issue that has no PR yet", () => {
    expect(sessionWorkSummary(item({ phase: "none", issue: 1014, issueTitle: "t" }))?.issue).toBe(1014);
  });

  // Finished work is not what the phone should be showing — the same rule the header chip follows
  // when it clears itself on merge (#979).
  it.each(["merged", "closed"] as const)("sends nothing once the PR is %s", (phase) => {
    expect(sessionWorkSummary(item({ phase, pr: 987, issue: 979, issueTitle: "t" }))).toBeUndefined();
  });

  it("sends nothing for a directory with no PR and no issue", () => {
    expect(sessionWorkSummary(item())).toBeUndefined();
  });

  it("still sends the numbers when no title could be read", () => {
    expect(sessionWorkSummary(item({ phase: "ci-running", pr: 987 }))).toEqual({ pr: 987, issue: null, phase: "ci-running", headline: null });
  });
});
