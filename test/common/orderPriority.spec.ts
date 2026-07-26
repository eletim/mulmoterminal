import { describe, it, expect } from "vitest";
import { normalizeOrderPriority } from "../../common/orderPriority";

describe("normalizeOrderPriority", () => {
  it("keeps any integer rank, including zero and negatives", () => {
    expect(normalizeOrderPriority(10)).toBe(10);
    expect(normalizeOrderPriority(0)).toBe(0);
    expect(normalizeOrderPriority(-5)).toBe(-5);
    expect(normalizeOrderPriority(999999)).toBe(999999);
  });

  // A rank is an ordering, so a fraction buys nothing — and the two boundaries disagreeing on
  // this is exactly what made it shared: one side accepted 1.5 while the other read it as unset.
  it("rejects a fractional rank rather than rounding it", () => {
    expect(normalizeOrderPriority(1.5)).toBeNull();
    expect(normalizeOrderPriority(-0.5)).toBeNull();
  });

  it("rejects anything that isn't a number, so the directory sorts last", () => {
    expect(normalizeOrderPriority(undefined)).toBeNull();
    expect(normalizeOrderPriority(null)).toBeNull();
    expect(normalizeOrderPriority("3")).toBeNull();
    expect(normalizeOrderPriority(NaN)).toBeNull();
    expect(normalizeOrderPriority(Infinity)).toBeNull();
    expect(normalizeOrderPriority(-Infinity)).toBeNull();
    expect(normalizeOrderPriority({})).toBeNull();
    expect(normalizeOrderPriority([])).toBeNull();
    expect(normalizeOrderPriority(true)).toBeNull();
  });
});
