import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import GitBranchChip from "../../../src/components/GitBranchChip.vue";
import type { GitStatus } from "../../../common/gitStatus";

const base: GitStatus = { repo: true, branch: "main", detached: false, dirty: 0, ahead: 0, behind: 0, upstream: false };

const render = (status: GitStatus | null, hideDirty = false) => mount(GitBranchChip, { props: { status, hideDirty } });
const chipClasses = (status: GitStatus = base) => render(status).get('[data-testid="git-chip"]').classes();

describe("GitBranchChip", () => {
  it("renders nothing when status is null", () => {
    expect(render(null).find('[data-testid="git-chip"]').exists()).toBe(false);
  });

  it("renders nothing for a non-git dir (repo:false)", () => {
    expect(
      render({ ...base, repo: false, branch: null })
        .find('[data-testid="git-chip"]')
        .exists(),
    ).toBe(false);
  });

  it("shows the branch name on a clean repo", () => {
    const w = render(base);
    expect(w.find('[data-testid="git-chip"]').exists()).toBe(true);
    expect(w.find('[data-testid="git-branch"]').text()).toContain("main");
    expect(w.find('[data-testid="git-dirty"]').exists()).toBe(false);
  });

  it("uses a theme surface and foreground instead of deriving contrast from currentColor", () => {
    const classes = chipClasses();
    expect(classes).toEqual(expect.arrayContaining(["bg-panel", "text-fg", "border", "border-border"]));
    expect(classes).not.toContain("text-inherit");
    expect(classes).not.toContain("opacity-85");
    expect(classes.some((c) => c.includes("currentColor"))).toBe(false);
  });

  it("shows the dirty count when there are uncommitted changes", () => {
    const w = render({ ...base, dirty: 3 });
    expect(w.find('[data-testid="git-dirty"]').text()).toBe("●3");
  });

  it("hides the dirty count when hideDirty is set (worktree cell)", () => {
    const w = render({ ...base, dirty: 3 }, true);
    expect(w.find('[data-testid="git-dirty"]').exists()).toBe(false);
    expect(w.find('[data-testid="git-branch"]').text()).toContain("main");
  });

  it("shows ahead/behind only when an upstream exists", () => {
    const noUpstream = render({ ...base, ahead: 2, behind: 1, upstream: false });
    expect(noUpstream.findAll('[data-testid="git-ab"]')).toHaveLength(0);
    const withUpstream = render({ ...base, ahead: 2, behind: 1, upstream: true });
    const abs = withUpstream.findAll('[data-testid="git-ab"]').map((n) => n.text());
    expect(abs).toEqual(["↑2", "↓1"]);
  });

  it("labels a detached HEAD", () => {
    const w = render({ ...base, branch: null, detached: true });
    expect(w.find('[data-testid="git-branch"]').text()).toContain("detached");
    expect(w.get('[data-testid="git-chip"]').classes()).toContain("text-[#d19a66]");
  });

  // #921: the chip sits in a `flex ... overflow-hidden` header row, where a flex item shrinks by
  // default. Without this it collapsed in a narrow grid cell and the clipped text left just the
  // padded, rounded background — reported as "an empty badge", which is a much harder thing to
  // diagnose than a missing one. Every other item in that row already carried flex-none.
  //
  // jsdom does no layout, so the class is the only thing assertable here — and the class IS the
  // fix. Width capping stays `max-w-[16ch]` + the inner ellipsis, so a long branch still truncates.
  it("does not shrink in a tight header row", () => {
    expect(render(base).find('[data-testid="git-chip"]').classes()).toContain("flex-none");
  });
});
