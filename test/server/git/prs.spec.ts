// @vitest-environment node
import { describe, it, expect } from "vitest";
import { rollupCiState } from "../../../server/git/prs";

describe("rollupCiState", () => {
  it("is none for an empty / non-array rollup", () => {
    expect(rollupCiState([])).toBe("none");
    expect(rollupCiState(null)).toBe("none");
    expect(rollupCiState(undefined)).toBe("none");
  });
  it("is passing when every check succeeded (CheckRun conclusion + StatusContext state)", () => {
    expect(rollupCiState([{ conclusion: "SUCCESS" }, { state: "SUCCESS" }, { conclusion: "SKIPPED" }])).toBe("passing");
  });
  it("is failing if any check failed (conclusion or state)", () => {
    expect(rollupCiState([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }])).toBe("failing");
    expect(rollupCiState([{ state: "ERROR" }])).toBe("failing");
    expect(rollupCiState([{ conclusion: "SUCCESS" }, { conclusion: "TIMED_OUT" }])).toBe("failing");
  });
  it("is pending when a non-failing check is not yet successful", () => {
    expect(rollupCiState([{ status: "IN_PROGRESS", conclusion: "" }, { conclusion: "SUCCESS" }])).toBe("pending");
    expect(rollupCiState([{ state: "PENDING" }])).toBe("pending");
  });
});
