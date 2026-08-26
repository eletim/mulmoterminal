// @vitest-environment node
// Core metadata owns an existing terminal's cwd; the request owns only a fresh session's cwd.
import { describe, it, expect } from "vitest";
import { effectiveSessionCwd } from "../../../server/routes/ws-routes";

describe("effectiveSessionCwd", () => {
  it("takes the Core directory when there is one", () => {
    expect(effectiveSessionCwd("/work/real", "/home/me/workspace")).toBe("/work/real");
  });

  // A brand-new session has no Core member yet; the request decides where it will spawn.
  it("falls back to the request's directory for a new session", () => {
    expect(effectiveSessionCwd(undefined, "/work/new")).toBe("/work/new");
  });

  it("prefers the Core directory even when the two agree", () => {
    expect(effectiveSessionCwd("/work/same", "/work/same")).toBe("/work/same");
  });
});
