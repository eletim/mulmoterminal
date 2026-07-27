import { describe, it, expect } from "vitest";
import { dirChipColor, dirChipTint } from "../../../src/components/dirChipColor";

const chrome = (over: Partial<Parameters<typeof dirChipColor>[0]> = {}) => ({
  headerColor: null,
  badgeColor: null,
  cellColor: null,
  dotColor: null,
  ...over,
});

describe("dirChipColor", () => {
  it("has no colour for a directory that configured none", () => {
    expect(dirChipColor(chrome())).toBeNull();
  });

  it("takes the header colour first — it is what the grid makes most visible", () => {
    expect(dirChipColor(chrome({ headerColor: "#112233", badgeColor: "#445566", cellColor: "#778899", dotColor: "#aabbcc" }))).toBe("#112233");
  });

  it("falls back through badge, then cell, then dot", () => {
    expect(dirChipColor(chrome({ badgeColor: "#445566", cellColor: "#778899", dotColor: "#aabbcc" }))).toBe("#445566");
    expect(dirChipColor(chrome({ cellColor: "#778899", dotColor: "#aabbcc" }))).toBe("#778899");
    expect(dirChipColor(chrome({ dotColor: "#aabbcc" }))).toBe("#aabbcc");
  });

  // The value reaches a style binding, so anything the server's schema wouldn't have produced
  // is skipped rather than passed through — and a later field can still supply a real colour.
  it("skips a value that is not 6-digit hex", () => {
    expect(dirChipColor(chrome({ headerColor: "red" }))).toBeNull();
    expect(dirChipColor(chrome({ headerColor: "#fff" }))).toBeNull();
    expect(dirChipColor(chrome({ headerColor: "#12345g" }))).toBeNull();
    expect(dirChipColor(chrome({ headerColor: "javascript:alert(1)", badgeColor: "#445566" }))).toBe("#445566");
  });
});

describe("dirChipTint", () => {
  it("washes the chip and warms its border in the directory's colour", () => {
    const style = dirChipTint("#112233", false);
    expect(style.background).toContain("#112233");
    expect(style.background).toContain("var(--bg-elevated)"); // a wash, not the raw colour
    expect(style.borderColor).toContain("#112233");
  });

  // The running chip's blue means "a session is already here". A second meaning on the same
  // background is how both stop being readable — the stripe still carries the dir's colour.
  it("leaves the background alone while a session is running there", () => {
    expect(dirChipTint("#112233", true)).toEqual({});
  });

  it("leaves a directory that configured no colour exactly as it was", () => {
    expect(dirChipTint(null, false)).toEqual({});
  });
});
