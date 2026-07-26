import { describe, expect, it } from "vitest";

import {
  cellFromPoint,
  clearResetModes,
  clickReportSequences,
  isClickGesture,
  recordSwallowedModes,
  wantsMouseReports,
  wheelReportSequence,
} from "../../../src/composables/mouseReports";

// Claude Code's actual request: drag tracking + SGR encoding in one SET.
const CLAUDE_SET: (number | number[])[] = [1002, 1006];

describe("recordSwallowedModes / clearResetModes", () => {
  it("remembers a swallowed set and forgets it on reset", () => {
    const active = new Set<number>();
    recordSwallowedModes(active, CLAUDE_SET);
    expect(wantsMouseReports(active)).toBe(true);
    clearResetModes(active, CLAUDE_SET);
    expect(wantsMouseReports(active)).toBe(false);
  });

  it("reads the mode from a sub-parameter param", () => {
    const active = new Set<number>();
    recordSwallowedModes(active, [[1000, 4], 1006]);
    expect(wantsMouseReports(active)).toBe(true);
  });

  it("keeps wanting mouse reports while any tracking mode is still set", () => {
    const active = new Set<number>();
    recordSwallowedModes(active, [1000, 1002, 1006]);
    clearResetModes(active, [1002]);
    expect(wantsMouseReports(active)).toBe(true);
    clearResetModes(active, [1000]);
    expect(wantsMouseReports(active)).toBe(false);
  });

  it("ignores a reset for a mode that was never recorded", () => {
    const active = new Set<number>();
    clearResetModes(active, [1002, 1006]);
    expect(active.size).toBe(0);
  });
});

describe("wantsMouseReports", () => {
  it("requires the SGR encoding: tracking alone is not enough", () => {
    const active = new Set([1002]);
    expect(wantsMouseReports(active)).toBe(false);
  });

  it("requires a tracking mode: SGR alone is not enough", () => {
    const active = new Set([1006]);
    expect(wantsMouseReports(active)).toBe(false);
  });

  it("is false for an empty record and for unrelated modes", () => {
    expect(wantsMouseReports(new Set())).toBe(false);
    expect(wantsMouseReports(new Set([25, 1049]))).toBe(false);
  });

  it("accepts every wheel-capable tracking mode with SGR", () => {
    [1000, 1001, 1002, 1003].forEach((mode) => {
      expect(wantsMouseReports(new Set([mode, 1006]))).toBe(true);
    });
  });
});

describe("wheelReportSequence", () => {
  it("encodes wheel-up as button 64 and wheel-down as 65", () => {
    expect(wheelReportSequence(-1, 1, 1)).toBe("\x1b[<64;1;1M");
    expect(wheelReportSequence(120, 1, 1)).toBe("\x1b[<65;1;1M");
  });

  it("embeds the cell coordinates", () => {
    expect(wheelReportSequence(3, 12, 40)).toBe("\x1b[<65;12;40M");
  });

  it("returns null when there is no vertical motion", () => {
    expect(wheelReportSequence(0, 1, 1)).toBeNull();
  });
});

describe("clickReportSequences", () => {
  it("sends the main button as a press/release pair on the same cell", () => {
    expect(clickReportSequences(12, 5)).toEqual(["\x1b[<0;12;5M", "\x1b[<0;12;5m"]);
  });
});

// An 80x20 grid drawn at (100, 50), so each cell is 10px wide and 20px tall — the arithmetic
// stays readable and every boundary below is exact.
const GRID_RECT = new DOMRect(100, 50, 800, 400);
const COLS = 80;
const ROWS = 20;
const at = (clientX: number, clientY: number) => ({ clientX, clientY });

describe("cellFromPoint", () => {
  it("numbers cells from 1, not 0", () => {
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(100, 50))).toEqual({ col: 1, row: 1 });
  });

  it("keeps the last pixel of a cell inside it, and the next pixel in the next cell", () => {
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(109, 69))).toEqual({ col: 1, row: 1 });
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(110, 70))).toEqual({ col: 2, row: 2 });
  });

  it("maps an interior point to its cell", () => {
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(455, 253))).toEqual({ col: 36, row: 11 });
  });

  it("clamps a pointer that left the grid to the edge cells", () => {
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(-500, -500))).toEqual({ col: 1, row: 1 });
    expect(cellFromPoint(GRID_RECT, COLS, ROWS, at(5000, 5000))).toEqual({ col: COLS, row: ROWS });
  });

  // An unlaid-out (or hidden) terminal measures zero; dividing by it would report NaN cells.
  it("falls back to the top-left cell when the element has no box", () => {
    expect(cellFromPoint(new DOMRect(0, 0, 0, 0), COLS, ROWS, at(42, 42))).toEqual({ col: 1, row: 1 });
  });
});

describe("isClickGesture", () => {
  it("accepts a press and release that did not move", () => {
    expect(isClickGesture(at(200, 100), at(200, 100))).toBe(true);
  });

  it("tolerates the drift of an ordinary click, in either direction", () => {
    expect(isClickGesture(at(200, 100), at(203, 97))).toBe(true);
  });

  it("rejects a drag — that is a text selection, not a click", () => {
    expect(isClickGesture(at(200, 100), at(204, 100))).toBe(false);
    expect(isClickGesture(at(200, 100), at(200, 140))).toBe(false);
  });
});
