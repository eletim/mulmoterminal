// @vitest-environment node
// A live terminal's directory comes only from Core metadata.
import { describe, it, expect } from "vitest";
import { pickSessionCwd } from "../../../server/session/session-cwd.js";

const WORKSPACE = "/home/u/mulmoclaude";

describe("pickSessionCwd", () => {
  it("uses the Core directory", () => {
    expect(pickSessionCwd({ coreCwd: "/repos/a", workspace: WORKSPACE })).toBe("/repos/a");
  });

  it("falls back to the workspace when neither is known", () => {
    expect(pickSessionCwd({ workspace: WORKSPACE })).toBe(WORKSPACE);
    expect(pickSessionCwd({ coreCwd: null, workspace: WORKSPACE })).toBe(WORKSPACE);
  });

  it("treats an empty Core cwd as unknown", () => {
    expect(pickSessionCwd({ coreCwd: "", workspace: WORKSPACE })).toBe(WORKSPACE);
  });
});
