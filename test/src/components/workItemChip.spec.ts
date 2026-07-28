// The chip that says which PR / issue a cell is on. Two things decide what a user sees: whether
// there is anything to show at all (a merged PR must vanish, #979), and how a server response is
// read into the shape the template trusts.
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import WorkItemChip from "../../../src/components/WorkItemChip.vue";
import { hasWorkToShow, parseWorkItem } from "../../../src/composables/useWorkItem";
import { EMPTY_WORK_ITEM, type WorkItem } from "../../../common/prPhase";

const item = (over: Partial<WorkItem> = {}): WorkItem => ({ ...EMPTY_WORK_ITEM, ...over });

describe("hasWorkToShow", () => {
  it("shows a PR with its issue", () => {
    expect(hasWorkToShow(item({ phase: "ready", pr: 977, issue: 966 }))).toBe(true);
  });

  // Most of the time a cell spends on an issue, there is no PR yet.
  it("shows an issue that has no PR yet", () => {
    expect(hasWorkToShow(item({ phase: "none", issue: 979 }))).toBe(true);
  });

  it("shows a PR that closes no issue", () => {
    expect(hasWorkToShow(item({ phase: "ci-running", pr: 977 }))).toBe(true);
  });

  // The clear-on-merge rule: the work is over, and a badge left behind is what makes the header
  // untrustworthy in the first place.
  it.each(["merged", "closed"] as const)("shows nothing once the PR is %s", (phase) => {
    expect(hasWorkToShow(item({ phase, pr: 977, issue: 966 }))).toBe(false);
  });

  it("shows nothing for a cell with neither", () => {
    expect(hasWorkToShow(item())).toBe(false);
  });
});

describe("parseWorkItem", () => {
  it("reads the server's shape", () => {
    const parsed = parseWorkItem({ phase: "ready", pr: 977, prUrl: "https://x/pull/977", issue: 966, issueUrl: "https://x/issues/966" });
    expect(parsed).toEqual({ phase: "ready", pr: 977, prUrl: "https://x/pull/977", issue: 966, issueUrl: "https://x/issues/966" });
  });

  // A proxy answering HTML, or an older server that only knows `phase`/`url`, must not put
  // `undefined` in the template.
  it.each([
    ["a body that is not an object", "<!doctype html>"],
    ["null", null],
    ["an unknown phase", { phase: "shipped", pr: 1 }],
    ["no phase at all", { pr: 1 }],
  ])("falls back to empty for %s", (_label, data) => {
    expect(parseWorkItem(data)).toEqual(EMPTY_WORK_ITEM);
  });

  it("drops field values of the wrong type rather than showing them", () => {
    expect(parseWorkItem({ phase: "ready", pr: "977", prUrl: 3, issue: 1.5, issueUrl: "" })).toEqual({ ...EMPTY_WORK_ITEM, phase: "ready" });
  });
});

describe("WorkItemChip", () => {
  it("renders the PR, the issue and the phase, each linked", () => {
    const w = mount(WorkItemChip, {
      props: { item: item({ phase: "ready", pr: 977, prUrl: "https://x/pull/977", issue: 966, issueUrl: "https://x/issues/966" }) },
    });
    expect(w.get('[data-testid="work-pr"]').text()).toBe("#977");
    expect(w.get('[data-testid="work-pr"]').attributes("href")).toBe("https://x/pull/977");
    expect(w.get('[data-testid="work-issue"]').text()).toBe("#966");
    expect(w.get('[data-testid="work-issue"]').attributes("href")).toBe("https://x/issues/966");
    expect(w.get('[data-testid="work-phase"]').text()).toBe("ready");
    expect(w.get('[data-testid="work-chip"]').attributes("title")).toContain("PR #977");
  });

  it("renders the issue alone before a PR exists, with no arrow", () => {
    const w = mount(WorkItemChip, { props: { item: item({ phase: "none", issue: 979, issueUrl: "https://x/issues/979" }) } });
    expect(w.get('[data-testid="work-issue"]').text()).toBe("#979");
    expect(w.find('[data-testid="work-pr"]').exists()).toBe(false);
    expect(w.find('[data-testid="work-arrow"]').exists()).toBe(false);
    expect(w.find('[data-testid="work-phase"]').exists()).toBe(false); // "none" has no label
  });

  it.each(["merged", "closed"] as const)("renders nothing at all once %s", (phase) => {
    const w = mount(WorkItemChip, { props: { item: item({ phase, pr: 977, issue: 966 }) } });
    expect(w.find('[data-testid="work-chip"]').exists()).toBe(false);
  });
});
