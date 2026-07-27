import { describe, it, expect } from "vitest";
import { dirChipColor } from "../../../src/components/dirChipColor";

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
