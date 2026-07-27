// The focused cell grows; its contents shrink by the inverse of the SAME token, so the composition
// is identity and the terminal's canvas is still rasterised 1:1. Measured against Chromium, scaling
// the canvas by 1.03 changes 22% of its pixels, and cancelling about the wrong centre still changes
// 14% (#965) — so what these guard is that neither side grows a literal of its own. #331 already
// retuned this scale once; the next tweak has to move one token and stay cancelled.
import { describe, it, expect } from "vitest";
import terminalGridSource from "../../../src/components/TerminalGrid.vue?raw";
import terminalCellSource from "../../../src/components/TerminalCell.vue?raw";
import { CELL_FRAME, CELL_INNER } from "../../../src/components/cellChromeClasses";

describe("focus zoom", () => {
  it("scales the focused cell by the token, not a literal", () => {
    expect(terminalGridSource).toContain("transform: scale(var(--focus-zoom))");
    expect(terminalGridSource).not.toMatch(/transform:\s*scale\(1\./);
  });

  it("cancels exactly that scale on the cell's contents", () => {
    expect(CELL_INNER).toContain("scale-[calc(1/var(--focus-zoom))]");
    expect(CELL_INNER).toContain("group-[.focused]/cell:");
  });

  // The variant above only matches inside an ancestor carrying the group name, so a cell that
  // loses it keeps its contents at full size and blurs again — without failing anything else.
  it("names the group on every cell's frame", () => {
    expect(CELL_FRAME).toContain("group/cell");
    expect(terminalCellSource).toContain("group/cell");
  });
});
