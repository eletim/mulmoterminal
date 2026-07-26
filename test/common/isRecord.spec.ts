// @vitest-environment node
//
// The guard replaced 29 hand-copied definitions, 28 of which let arrays through (#828). What is
// pinned here is the behaviour that differs from those copies — an array is NOT a record — plus
// the everyday cases every call site depends on.
import { describe, it, expect } from "vitest";
import { isRecord } from "../../common/isRecord.js";

describe("isRecord", () => {
  it("accepts an object literal, empty or not", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  // The reason the shared version excludes arrays: TypeScript itself refuses
  // `const r: Record<string, unknown> = []`, so narrowing an array to Record is a lie — and a
  // caller that goes on to Object.entries() the value would walk array indices as field names.
  it("rejects an array, empty or not", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([{ a: 1 }])).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isRecord("")).toBe(false);
    expect(isRecord("{}")).toBe(false);
    expect(isRecord(0)).toBe(false);
    expect(isRecord(false)).toBe(false);
  });

  it("rejects a function", () => {
    expect(isRecord(() => ({}))).toBe(false);
  });

  // Known and accepted: only arrays are singled out. graphai's isPlainObject would reject these
  // too, but it is not exported from the package root, and no caller feeds them in — every input
  // is JSON.parse output or a request body.
  it("accepts other object instances, which no call site feeds it", () => {
    expect(isRecord(new Date())).toBe(true);
    expect(isRecord(new Map())).toBe(true);
  });

  it("narrows so a field can be read without a cast", () => {
    const parsed: unknown = JSON.parse('{"cwd":"/tmp"}');
    expect(isRecord(parsed) && typeof parsed.cwd === "string" ? parsed.cwd : null).toBe("/tmp");
  });

  it("keeps a JSON array out of the record branch", () => {
    const parsed: unknown = JSON.parse("[1,2,3]");
    expect(isRecord(parsed)).toBe(false);
  });
});
