import { describe, it, expect } from "vitest";
import { paneCanShowClick, type PaneClickState } from "../../../src/components/paneClickTarget";

// #910. The grid's half of "can this clicked path open in the pane" — the half that is about
// the grid's own state rather than the path. A wrong `false` just leaves the click on its old
// route; a wrong `true` opens the file against the wrong directory, so the cases below are
// the ones where two directories are in play at once.
describe("paneCanShowClick", () => {
  const CWD = "/Users/me/proj";
  const state = (over: Partial<PaneClickState> = {}): PaneClickState => ({ zoomed: true, expandedCwd: CWD, paneCwd: CWD, ...over });

  it("takes a click from the enlarged cell", () => {
    expect(paneCanShowClick(state(), CWD)).toBe(true);
  });

  // First click with the pane closed: it has never rooted anywhere, and is about to root on
  // the enlarged cell. Requiring paneCwd to match here would make the pane unreachable until
  // the user opened it by hand first — which is the whole point of this entrance.
  it("takes the first click, before the pane has ever opened", () => {
    expect(paneCanShowClick(state({ paneCwd: null }), CWD)).toBe(true);
  });

  it("declines when nothing is enlarged — there is no pane on screen", () => {
    expect(paneCanShowClick(state({ zoomed: false }), CWD)).toBe(false);
    expect(paneCanShowClick(state({ zoomed: false, paneCwd: null }), CWD)).toBe(false);
  });

  // Every cell stays mounted while one is enlarged (the filmstrip), so a thumbnail can be
  // clicked. Its path has nothing to do with the pane beside the enlarged cell.
  it("declines a click from a cell that is not the enlarged one", () => {
    expect(paneCanShowClick(state(), "/Users/me/other")).toBe(false);
  });

  // The pane stays behind when a re-root could not be saved out of. Its tree is still on the
  // previous cell's directory, so a path relative to the enlarged one resolves elsewhere.
  it("declines while the pane trails the zoom on another directory", () => {
    expect(paneCanShowClick(state({ paneCwd: "/Users/me/other" }), CWD)).toBe(false);
  });

  it("declines when the enlarged cell has not reported a directory yet", () => {
    expect(paneCanShowClick(state({ expandedCwd: null }), CWD)).toBe(false);
  });
});
