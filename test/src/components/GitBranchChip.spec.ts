import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import GitBranchChip from "../../../src/components/GitBranchChip.vue";
import type { GitStatus } from "../../../common/gitStatus";

const base: GitStatus = { repo: true, branch: "main", detached: false, dirty: 0, ahead: 0, behind: 0, upstream: false };

const render = (status: GitStatus | null, hideDirty = false) => mount(GitBranchChip, { props: { status, hideDirty } });

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
  });

  // `--amber`'s light-appearance variant (#b8860b) still reads under 3:1 against bg-elevated on
  // Daylight/Solarized (measured, not assumed) — `--warn`'s (#8a4b00) is darker and clears AA on
  // every built-in theme, so detached moved to that token instead.
  it("colors a detached HEAD with the warn token, not amber", () => {
    const classes = render({ ...base, branch: null, detached: true })
      .find('[data-testid="git-chip"]')
      .classes();
    expect(classes).toContain("text-warn");
    expect(classes).not.toContain("text-amber");
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

  // The chip used to inherit its text color from the header (`text-inherit`) and derive its
  // background from that same inherited color (`color-mix(in srgb, currentColor 12%, transparent)`).
  // A directory with `headerTextColor: "#ffffff"` made the chip's text white AND its background a
  // white-derived wash — near-white on near-white. Both must now come from theme tokens instead,
  // so a white header text color can no longer erase the chip sitting on top of it.
  describe("colors do not depend on the parent's inherited text color", () => {
    it("does not use text-inherit for a normal branch", () => {
      expect(render(base).find('[data-testid="git-chip"]').classes()).not.toContain("text-inherit");
    });

    it("does not derive its background from currentColor", () => {
      const classes = render(base).find('[data-testid="git-chip"]').classes();
      expect(classes.some((c) => c.includes("currentColor"))).toBe(false);
    });

    it("carries theme-token background and text classes for a normal branch", () => {
      const classes = render(base).find('[data-testid="git-chip"]').classes();
      expect(classes).toContain("bg-elevated");
      expect(classes).toContain("text-fg");
    });

    // jsdom does no layout or color resolution, so this can only assert the classes are present
    // regardless of what the (irrelevant, in this mount) parent would have set on `color` — the
    // fix is precisely that the chip no longer reads that value at all.
    it("still carries its own contrast classes when the parent sets a white text color", () => {
      const w = mount(GitBranchChip, {
        props: { status: base, hideDirty: false },
        attachTo: (() => {
          const host = document.createElement("div");
          host.style.color = "#ffffff";
          document.body.appendChild(host);
          return host;
        })(),
      });
      const classes = w.find('[data-testid="git-chip"]').classes();
      expect(classes).toContain("bg-elevated");
      expect(classes).toContain("text-fg");
      expect(classes).not.toContain("text-inherit");
    });
  });
});
