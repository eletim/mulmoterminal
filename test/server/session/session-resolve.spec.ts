// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveSession, type SessionFacts, resolveReattachableId, canStartLauncher, isContinuingSession } from "../../../server/session/session-resolve.js";

const FIXED = "fresh-minted-id";
const mint = () => FIXED;
const facts = (over: Partial<SessionFacts> = {}): SessionFacts => ({ coreExists: false, hasViewer: false, onDisk: false, ...over });

describe("resolveSession", () => {
  it("mints a fresh id when nothing is requested", () => {
    expect(resolveSession(null, facts(), mint)).toEqual({ reattachId: null, resume: null, sessionId: FIXED });
  });

  it("mints a fresh id when the requested session can't be served (not live, tmux, or on disk)", () => {
    // e.g. reloading an idle session claude never persisted — reusing its id under
    // --session-id would abort, so we start fresh and the browser adopts the new id.
    expect(resolveSession("s1", facts(), mint)).toEqual({ reattachId: null, resume: null, sessionId: FIXED });
  });

  it("reattaches a viewer only when Core still contains the session", () => {
    expect(resolveSession("s1", facts({ coreExists: true, hasViewer: true }), mint)).toEqual({ reattachId: "s1", resume: null, sessionId: "s1" });
  });

  it("resumes an on-disk transcript", () => {
    expect(resolveSession("s1", facts({ onDisk: true }), mint)).toEqual({ reattachId: null, resume: "s1", sessionId: FIXED });
  });

  it("reuses the id for a Core session even without a local viewer", () => {
    expect(resolveSession("s1", facts({ coreExists: true }), mint)).toEqual({ reattachId: null, resume: null, sessionId: "s1" });
  });

  it("ignores history when the terminal still exists in Core", () => {
    expect(resolveSession("s1", facts({ coreExists: true, onDisk: true }), mint)).toEqual({ reattachId: null, resume: null, sessionId: "s1" });
  });

  it("prefers a Core viewer over history", () => {
    expect(resolveSession("s1", facts({ coreExists: true, hasViewer: true, onDisk: true }), mint)).toEqual({ reattachId: "s1", resume: null, sessionId: "s1" });
  });
});

// /ws/launch and /ws/codex reuse a requested id only when something can actually serve it.
// Handing back an id nothing can serve strands the client on a dead session.
describe("resolveReattachableId", () => {
  const mint = () => "FRESH";
  const facts = (over = {}) => ({ coreExists: false, hasViewer: false, ...over });

  it("mints a fresh id when nothing was requested", () => {
    expect(resolveReattachableId(null, facts(), mint)).toEqual({ reattachId: null, sessionId: "FRESH" });
  });

  it("reattaches a live pty in this process", () => {
    expect(resolveReattachableId("REQ", facts({ coreExists: true, hasViewer: true }), mint)).toEqual({ reattachId: "REQ", sessionId: "REQ" });
  });

  it("keeps the id for a Core member without a local viewer", () => {
    expect(resolveReattachableId("REQ", facts({ coreExists: true }), mint)).toEqual({ reattachId: null, sessionId: "REQ" });
  });

  it("mints a new Core id when resuming agent history", () => {
    expect(resolveReattachableId("REQ", facts(), mint)).toEqual({ reattachId: null, sessionId: "FRESH" });
  });

  it("mints a fresh id when the requested one cannot be served", () => {
    expect(resolveReattachableId("REQ", facts(), mint)).toEqual({ reattachId: null, sessionId: "FRESH" });
  });

  it("prefers the live pty when several facts hold at once", () => {
    expect(resolveReattachableId("REQ", facts({ coreExists: true, hasViewer: true }), mint)).toEqual({ reattachId: "REQ", sessionId: "REQ" });
  });

  it("never reattaches without a requested id, whatever the facts say", () => {
    expect(resolveReattachableId(null, facts({ coreExists: true, hasViewer: true }), mint)).toEqual({ reattachId: null, sessionId: "FRESH" });
  });
});

// What the worktree limit asks before refusing a spawn: is this connection creating a session, or
// continuing one? Reading it off the resolved id is the point — Codex caught the first version
// re-listing the ways a session can continue and missing tmux-only liveness, which turns a
// reconnect after a server restart into a "new session" and refuses it (#1208).
describe("isContinuingSession", () => {
  it("is false when nothing was requested", () => {
    expect(isContinuingSession(null, "FRESH")).toBe(false);
  });

  it("is false when the requested id could not be served and a fresh one was minted", () => {
    const { sessionId } = resolveReattachableId("REQ", { coreExists: false, hasViewer: false }, () => "FRESH");
    expect(isContinuingSession("REQ", sessionId)).toBe(false);
  });

  // The regression: a session that outlived the server exists only in tmux — no live pty, and for
  // codex/antigravity no cold-resume id either, since `tmux new-session -A` reattaches the running
  // program instead.
  it("is true for a Core-only reattach", () => {
    const { sessionId } = resolveReattachableId("REQ", { coreExists: true, hasViewer: false }, () => "FRESH");
    expect(isContinuingSession("REQ", sessionId)).toBe(true);
  });

  it("is true for every other way a session continues", () => {
    const mintFresh = () => "FRESH";
    const claude = resolveSession("REQ", facts({ coreExists: true }), mintFresh);
    expect(isContinuingSession("REQ", claude.sessionId)).toBe(true);
    expect(isContinuingSession("REQ", resolveSession("REQ", facts({ coreExists: true, hasViewer: true }), mintFresh).sessionId)).toBe(true);
    expect(isContinuingSession("REQ", resolveSession("REQ", facts({ onDisk: true }), mintFresh).sessionId)).toBe(false);
    expect(isContinuingSession("REQ", resolveReattachableId("REQ", { coreExists: false, hasViewer: false }, mintFresh).sessionId)).toBe(false);
  });
});

// A launcher connection needs SOMETHING to run: an existing process to reattach to, a
// configured launcher at the requested index, or the "new terminal" shell button.
describe("canStartLauncher", () => {
  const facts = (over = {}) => ({ coreExists: false, hasLauncher: false, isShell: false, ...over });

  it("refuses when there is nothing to reattach and no launcher at that index", () => {
    expect(canStartLauncher(facts())).toBe(false);
  });

  it("allows a reattach even when the index names no launcher", () => {
    // The pty already IS the chosen program, so the index is irrelevant.
    expect(canStartLauncher(facts({ coreExists: true }))).toBe(true);
  });

  it("allows a fresh spawn of a configured launcher", () => {
    expect(canStartLauncher(facts({ hasLauncher: true }))).toBe(true);
  });

  it("allows the shell button, which has no configured index", () => {
    expect(canStartLauncher(facts({ isShell: true }))).toBe(true);
  });
});
