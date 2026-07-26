import { describe, it, expect, vi } from "vitest";
import { TERMINAL_FONT_SIZE_DEFAULT, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from "../../../common/terminalFontSize";

const STORAGE_KEY = "terminalFontSize";

// The startup value is read once at module load, so each case needs a fresh module.
const startupSizeWith = async (stored: string | null) => {
  localStorage.clear();
  if (stored !== null) localStorage.setItem(STORAGE_KEY, stored);
  vi.resetModules();
  const { useTerminalFontSize } = await import("../../../src/composables/useTerminalFontSize");
  return useTerminalFontSize().fontSize.value;
};

describe("useTerminalFontSize startup value", () => {
  it("adopts a stored size", async () => {
    expect(await startupSizeWith("18")).toBe(18);
  });

  it("falls back to the default when nothing is stored", async () => {
    expect(await startupSizeWith(null)).toBe(TERMINAL_FONT_SIZE_DEFAULT);
  });

  // Regression: `Number("")` is 0 — a finite number — so a blank value clamped to the minimum
  // and the app started at 8px, while every other unusable value fell back to the default.
  it("treats a blank stored value as unset rather than as zero", async () => {
    expect(await startupSizeWith("")).toBe(TERMINAL_FONT_SIZE_DEFAULT);
    expect(await startupSizeWith("   ")).toBe(TERMINAL_FONT_SIZE_DEFAULT);
  });

  it("falls back for a non-numeric stored value", async () => {
    expect(await startupSizeWith("abc")).toBe(TERMINAL_FONT_SIZE_DEFAULT);
  });

  it("clamps a stored size that is out of range", async () => {
    expect(await startupSizeWith("999")).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(await startupSizeWith("1")).toBe(TERMINAL_FONT_SIZE_MIN);
  });
});

describe("useTerminalFontSize updates", () => {
  const fresh = async () => {
    localStorage.clear();
    vi.resetModules();
    const { useTerminalFontSize } = await import("../../../src/composables/useTerminalFontSize");
    return useTerminalFontSize();
  };

  it("persists a set size so the next load keeps it", async () => {
    const { setFontSize, fontSize } = await fresh();
    setFontSize(20);
    expect(fontSize.value).toBe(20);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("20");
  });

  it("steps by the given delta and stops at the bounds", async () => {
    const { nudgeFontSize, fontSize } = await fresh();
    nudgeFontSize(2);
    expect(fontSize.value).toBe(TERMINAL_FONT_SIZE_DEFAULT + 2);
    nudgeFontSize(1000);
    expect(fontSize.value).toBe(TERMINAL_FONT_SIZE_MAX);
    nudgeFontSize(-1000);
    expect(fontSize.value).toBe(TERMINAL_FONT_SIZE_MIN);
  });

  it("ignores a non-finite size rather than storing it", async () => {
    const { setFontSize, fontSize } = await fresh();
    setFontSize(NaN);
    expect(fontSize.value).toBe(TERMINAL_FONT_SIZE_DEFAULT);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
