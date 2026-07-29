// @vitest-environment node
// Which directory gets REMEMBERED for a session (#1021). A reattach usually carries no `?cwd=`,
// and the resolver answers the default workspace when it is missing — so recording the request's
// value would file a session under CLAUDE_CWD while claude runs somewhere else, and the phone
// would then show that directory's PR (found by Codex review).
import { describe, it, expect } from "vitest";
import { effectiveSessionCwd } from "../../../server/routes/ws-routes";

describe("effectiveSessionCwd", () => {
  it("takes the live PTY's directory when there is one", () => {
    expect(effectiveSessionCwd("/work/real", "/home/me/workspace")).toBe("/work/real");
  });

  // A brand-new session has no PTY yet; the request decides where it will spawn.
  it("falls back to the request's directory for a new session", () => {
    expect(effectiveSessionCwd(undefined, "/work/new")).toBe("/work/new");
  });

  it("prefers the live directory even when the two agree", () => {
    expect(effectiveSessionCwd("/work/same", "/work/same")).toBe("/work/same");
  });
});
