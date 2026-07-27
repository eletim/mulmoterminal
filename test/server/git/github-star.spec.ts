// @vitest-environment node
import { describe, it, expect } from "vitest";

import { interpretStarCheck } from "../../../server/git/github-star.js";

describe("interpretStarCheck", () => {
  it("reads exit 0 as starred (gh answers 204 with no output)", () => {
    expect(interpretStarCheck({ ok: true, stdout: "", stderr: "" })).toBe(true);
  });

  it("reads gh's 404 as not starred", () => {
    expect(interpretStarCheck({ ok: false, stdout: "", stderr: "gh: Not Found (HTTP 404)\n" })).toBe(false);
  });

  // The regression this whole matcher exists for: runGh's own missing-binary message contains
  // the words "not found", so a prose match would report a confident "not starred" for a
  // machine that has no gh at all — and the UI would then offer a button that does nothing.
  it("reads a missing gh as unknown, not as not-starred", () => {
    const stderr = "gh not found (install the GitHub CLI and run `gh auth login`)";
    expect(interpretStarCheck({ ok: false, stdout: "", stderr })).toBeNull();
  });

  it("reads an auth failure as unknown", () => {
    expect(interpretStarCheck({ ok: false, stdout: "", stderr: "gh: Bad credentials (HTTP 401)\n" })).toBeNull();
  });

  it("reads a network failure as unknown", () => {
    expect(interpretStarCheck({ ok: false, stdout: "", stderr: "dial tcp: lookup api.github.com: no such host\n" })).toBeNull();
  });

  it("reads an empty stderr failure as unknown", () => {
    expect(interpretStarCheck({ ok: false, stdout: "", stderr: "" })).toBeNull();
  });
});
