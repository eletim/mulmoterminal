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

// Codex review on #881, verified independently: `Number.isInteger` accepts 2^53+1 and 1e300,
// while zod@4's `z.number().int()` — the strict half of this pair, in writableDirConfigSchema —
// rejects both. The whole reason this module exists is that the two boundaries must agree, so
// the lenient side has to be safe-integer too. Past 2^53 a value is not distinct from its
// neighbours, so it cannot express an ordering anyway.
describe("normalizeOrderPriority — agreement with the strict schema", () => {
  it("keeps the largest rank the strict schema also accepts", () => {
    expect(normalizeOrderPriority(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(normalizeOrderPriority(Number.MIN_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER);
  });

  it("rejects integers past the safe range, as the strict schema does", () => {
    expect(normalizeOrderPriority(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
    expect(normalizeOrderPriority(1e300)).toBeNull();
    expect(normalizeOrderPriority(-1e300)).toBeNull();
  });
});
