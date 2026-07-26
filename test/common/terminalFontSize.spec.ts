import { describe, it, expect } from "vitest";
import { normalizeFontSize, TERMINAL_FONT_SIZE_DEFAULT, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from "../../common/terminalFontSize";

describe("normalizeFontSize", () => {
  it("keeps a size inside the range", () => {
    expect(normalizeFontSize(14)).toBe(14);
    expect(normalizeFontSize(TERMINAL_FONT_SIZE_MIN)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(normalizeFontSize(TERMINAL_FONT_SIZE_MAX)).toBe(TERMINAL_FONT_SIZE_MAX);
  });

  // Clamped rather than dropped: honouring the direction the user asked for reads as working,
  // where falling back to the default reads as the setting being ignored.
  it("clamps a size outside the range instead of discarding it", () => {
    expect(normalizeFontSize(TERMINAL_FONT_SIZE_MAX + 100)).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(normalizeFontSize(1)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(normalizeFontSize(0)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(normalizeFontSize(-40)).toBe(TERMINAL_FONT_SIZE_MIN);
  });

  // xterm accepts a fractional size, but the cell metrics then disagree with the integer the
  // Settings stepper shows — and the stepper is where the user reads the value back.
  it("rounds a fractional size", () => {
    expect(normalizeFontSize(14.4)).toBe(14);
    expect(normalizeFontSize(14.5)).toBe(15);
  });

  // Non-numeric is a different thing from out-of-range: it means "nothing configured here",
  // so the caller falls back rather than being handed a clamped guess.
  it("returns null for anything that isn't a finite number", () => {
    expect(normalizeFontSize(null)).toBeNull();
    expect(normalizeFontSize(undefined)).toBeNull();
    expect(normalizeFontSize("16")).toBeNull();
    expect(normalizeFontSize(NaN)).toBeNull();
    expect(normalizeFontSize(Infinity)).toBeNull();
    expect(normalizeFontSize(-Infinity)).toBeNull();
    expect(normalizeFontSize({})).toBeNull();
    expect(normalizeFontSize([])).toBeNull();
    expect(normalizeFontSize(true)).toBeNull();
  });

  it("has a default inside its own range", () => {
    expect(TERMINAL_FONT_SIZE_DEFAULT).toBeGreaterThanOrEqual(TERMINAL_FONT_SIZE_MIN);
    expect(TERMINAL_FONT_SIZE_DEFAULT).toBeLessThanOrEqual(TERMINAL_FONT_SIZE_MAX);
  });
});
