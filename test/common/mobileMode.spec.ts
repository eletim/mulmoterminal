// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isMobileMode, MOBILE_MODES } from "../../common/mobileMode";

describe("isMobileMode", () => {
  it("accepts every listed mode", () => {
    for (const mode of MOBILE_MODES) expect(isMobileMode(mode)).toBe(true);
  });

  it("rejects an unlisted value", () => {
    expect(isMobileMode("foo")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isMobileMode("")).toBe(false);
  });

  it("rejects a differently-cased value — the check is exact, not case-insensitive", () => {
    expect(isMobileMode("LOCAL")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isMobileMode(undefined)).toBe(false);
  });
});
