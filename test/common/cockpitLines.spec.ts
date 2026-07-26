// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sanitizeCockpitLines, DEFAULT_COCKPIT_LINES, COCKPIT_LINES_MIN, COCKPIT_LINES_MAX } from "../../common/cockpitLines";

describe("sanitizeCockpitLines", () => {
  it("keeps whole numbers inside the range", () => {
    expect(sanitizeCockpitLines({ summary: 8, prompt: 1, response: 20 })).toEqual({ summary: 8, prompt: 1, response: 20 });
  });

  // The feature is opt-in: an install that never touched config.json must render exactly as before.
  it("falls back to 2/2/3 when nothing is configured", () => {
    expect(sanitizeCockpitLines(undefined)).toEqual(DEFAULT_COCKPIT_LINES);
    expect(sanitizeCockpitLines({})).toEqual(DEFAULT_COCKPIT_LINES);
  });

  it("rejects a non-object, so a stray scalar can't blank the roster", () => {
    for (const bad of ["8", 8, null, [], [8], true]) expect(sanitizeCockpitLines(bad)).toEqual(DEFAULT_COCKPIT_LINES);
  });

  // Per field: one typo shouldn't discard the two the user set correctly.
  it("falls back only for the bad field", () => {
    expect(sanitizeCockpitLines({ summary: 6, prompt: "x", response: 0 })).toEqual({
      summary: 6,
      prompt: DEFAULT_COCKPIT_LINES.prompt,
      response: DEFAULT_COCKPIT_LINES.response,
    });
  });

  it("accepts both ends of the range and rejects just outside them", () => {
    expect(sanitizeCockpitLines({ summary: COCKPIT_LINES_MIN, prompt: COCKPIT_LINES_MAX }).summary).toBe(COCKPIT_LINES_MIN);
    expect(sanitizeCockpitLines({ summary: COCKPIT_LINES_MIN, prompt: COCKPIT_LINES_MAX }).prompt).toBe(COCKPIT_LINES_MAX);
    expect(sanitizeCockpitLines({ summary: COCKPIT_LINES_MIN - 1, prompt: COCKPIT_LINES_MAX + 1, response: -5 })).toEqual(DEFAULT_COCKPIT_LINES);
  });

  // NaN/Infinity would reach the DOM as `-webkit-line-clamp: NaN`, which drops the clamp entirely.
  it("rejects NaN and Infinity rather than rendering them", () => {
    expect(sanitizeCockpitLines({ summary: Number.NaN, prompt: Number.POSITIVE_INFINITY, response: Number.NEGATIVE_INFINITY })).toEqual(DEFAULT_COCKPIT_LINES);
  });

  it("floors a fractional count", () => {
    expect(sanitizeCockpitLines({ summary: 4.9 }).summary).toBe(4);
    expect(sanitizeCockpitLines({ summary: 1.9 }).summary).toBe(1);
  });

  // The defaults are handed out by reference nowhere: a caller that mutates its result must not
  // change what the next unconfigured install gets.
  it("returns a fresh object each time", () => {
    const first = sanitizeCockpitLines(undefined);
    first.summary = 99;
    expect(sanitizeCockpitLines(undefined)).toEqual(DEFAULT_COCKPIT_LINES);
    expect(DEFAULT_COCKPIT_LINES.summary).toBe(2);
  });
});
