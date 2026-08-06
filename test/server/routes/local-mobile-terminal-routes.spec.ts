// @vitest-environment node
//
// The local-mode counterpart of the phone's remote-host terminal view (server/routes/local-
// mobile-terminal-routes.ts): same session access, reached over same-origin HTTP instead of a
// Firestore command channel. Every dependency here is a fake standing in for the SAME functions
// server/index.ts wires into the Firestore adapter (remoteHostListTerminalSessions & co) — this
// spec pins the ROUTE's contract (status codes, shapes, origin guard), not that plumbing, which
// terminalScreen.spec.ts and terminalInput.spec.ts already cover.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { localSessionActivity, mountLocalMobileTerminalRoutes, type LocalMobileTerminalRouteDeps } from "../../../server/routes/local-mobile-terminal-routes";
import { TerminalSessionNotFoundError, type SessionScreen, type TerminalSessionSummary } from "../../../server/backends/remoteHost/terminalScreen";
import { NO_BROWSER_ERROR } from "../../../server/backends/remoteHost/launchTerminal";
import { isLaunchAgent, LAUNCH_AGENTS } from "../../../common/launchAgent";
import type { AnsiRow } from "../../../common/ansiStyle";

const LIVE = randomUUID();
const TMUX_ONLY = randomUUID();
const GONE = randomUUID();
const NO_CWD = randomUUID();

// screen/STYLED_ROWS' text must agree byte for byte, matching what the route's consistency
// check (#7 round-3 review) requires of a real, same-capture pair — screen.screen is already
// `.trimEnd()`-ed by captureSessionScreen, so it must not end in trimmable whitespace either.
const SCREEN: SessionScreen = { screen: "$ echo", suggestion: "", quickCommands: [], cwd: "/home/user/project" };
const STYLED_ROWS: AnsiRow[] = [[{ text: "$ echo", fg: null, bg: null, bold: false }]];
const SESSIONS: TerminalSessionSummary[] = [{ id: LIVE, title: "one", cwd: "/home/user/project", live: true, agent: "claude" }];
const IDLE_ACTIVITY = { working: false, waiting: false, event: null, workPhase: null };

function appFor(overrides: Partial<LocalMobileTerminalRouteDeps> = {}, isAllowedOrigin: LocalMobileTerminalRouteDeps["isAllowedOrigin"] = () => true) {
  const writes: Array<{ id: string; chunk: string }> = [];
  const deps: LocalMobileTerminalRouteDeps = {
    isAllowedOrigin,
    listTerminalSessions: async () => SESSIONS,
    captureTerminalScreen: async (id) => {
      if (id === GONE) throw new TerminalSessionNotFoundError(id);
      return SCREEN;
    },
    writeToSession: (id, chunk) => {
      writes.push({ id, chunk });
      return id !== TMUX_ONLY;
    },
    canClearBox: () => false,
    submitSequence: () => "\r",
    sessionAgent: () => undefined,
    // Mirrors decideLaunchTerminal's own precedence (agent, then cwd), since the route relies on
    // that ordering to tell an invalid agent (400) apart from a valid one the host just can't
    // place (409) without comparing error text.
    launchTerminal: (agent, sessionId) => {
      if (!isLaunchAgent(agent)) return { ok: false, error: `agent must be one of: ${LAUNCH_AGENTS.join(", ")}` };
      if (sessionId === NO_CWD) return { ok: false, error: `no working directory known for session '${String(sessionId)}'` };
      return { ok: true };
    },
    launchTerminalAtCwd: (agent) => {
      if (!isLaunchAgent(agent)) return { ok: false, error: `agent must be one of: ${LAUNCH_AGENTS.join(", ")}` };
      return { ok: true };
    },
    // Every session reads idle by default — the interesting cases override this per test.
    activityOf: () => ({ working: false, waiting: false, event: null }),
    workPhaseOf: () => null,
    captureStyledScreen: async () => STYLED_ROWS,
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  mountLocalMobileTerminalRoutes(app, deps);
  return { app, writes };
}

describe("localSessionActivity", () => {
  it("adds the work phase alongside the working/waiting/event triple", () => {
    expect(localSessionActivity({ working: true, waiting: false, event: "PreToolUse" }, "planning")).toEqual({
      working: true,
      waiting: false,
      event: "PreToolUse",
      workPhase: "planning",
    });
  });

  it("carries a null work phase through as-is", () => {
    expect(localSessionActivity({ working: false, waiting: true, event: "Stop" }, null)).toEqual({
      working: false,
      waiting: true,
      event: "Stop",
      workPhase: null,
    });
  });
});

describe("POST /api/mobile/terminal-sessions", () => {
  it("creates a terminal through the injected launch function with a normalized cwd", async () => {
    const calls: Array<{ agent: unknown; cwd: string; requestId: string | undefined }> = [];
    const cwd = `${process.cwd()}/`;
    const { app } = appFor({
      launchTerminalAtCwd: (agent, resolvedCwd, requestId) => {
        calls.push({ agent, cwd: resolvedCwd, requestId });
        return { ok: true };
      },
    });
    const res = await request(app).post("/api/mobile/terminal-sessions").send({ agent: "codex", cwd });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(calls).toEqual([{ agent: "codex", cwd: process.cwd(), requestId: res.body.requestId }]);
  });

  it("400s an invalid agent without treating it as a shell command", async () => {
    let called = false;
    const { app } = appFor({
      launchTerminalAtCwd: () => {
        called = true;
        return { ok: false, error: "should not matter" };
      },
    });
    const res = await request(app).post("/api/mobile/terminal-sessions").send({ agent: "bash -lc env", cwd: process.cwd() });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("400s a missing cwd", async () => {
    const { app } = appFor();
    const res = await request(app).post("/api/mobile/terminal-sessions").send({ agent: "shell" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "cwd is required" });
  });

  it("400s a relative cwd before publishing a launch request", async () => {
    let called = false;
    const { app } = appFor({
      launchTerminalAtCwd: () => {
        called = true;
        return { ok: true };
      },
    });
    const res = await request(app).post("/api/mobile/terminal-sessions").send({ agent: "shell", cwd: "relative/path" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not an absolute path");
    expect(called).toBe(false);
  });

  it("409s an absolute cwd that cannot be used", async () => {
    const { app } = appFor();
    const res = await request(app).post("/api/mobile/terminal-sessions").send({ agent: "shell", cwd: "/no/such/mobile-terminal-cwd" });
    expect(res.status).toBe(409);
  });

  it("409s when no browser is open to receive the request", async () => {
    const { app } = appFor({ launchTerminalAtCwd: () => ({ ok: false, error: NO_BROWSER_ERROR }) });
    const res = await request(app).post("/api/mobile/terminal-sessions").send({ agent: "shell", cwd: process.cwd() });
    expect(res.status).toBe(409);
  });

  it("403s a disallowed Origin without publishing", async () => {
    let called = false;
    const { app } = appFor(
      {
        launchTerminalAtCwd: () => {
          called = true;
          return { ok: true };
        },
      },
      () => false,
    );
    const res = await request(app).post("/api/mobile/terminal-sessions").set("Origin", "https://evil.example").send({ agent: "shell", cwd: process.cwd() });
    expect(res.status).toBe(403);
    expect(called).toBe(false);
  });

  it("reports a pending launch request until the websocket records its session id", async () => {
    const { app } = appFor();
    const created = await request(app).post("/api/mobile/terminal-sessions").send({ agent: "shell", cwd: process.cwd() });
    const res = await request(app).get(`/api/mobile/terminal-launches/${created.body.requestId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionId: null });
  });
});

describe("GET /api/mobile/terminal-sessions", () => {
  it("adds an `activity` field to each session, normalized to idle when none is tracked", async () => {
    const { app } = appFor();
    const res = await request(app).get("/api/mobile/terminal-sessions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessions: [{ ...SESSIONS[0], activity: IDLE_ACTIVITY }] });
  });

  it("joins working/waiting/event/workPhase from the injected readers, by session id", async () => {
    const { app } = appFor({
      activityOf: (id) => (id === LIVE ? { working: true, waiting: false, event: "PreToolUse" } : { working: false, waiting: false, event: null }),
      workPhaseOf: (id) => (id === LIVE ? "implementing" : null),
    });
    const res = await request(app).get("/api/mobile/terminal-sessions");
    expect(res.status).toBe(200);
    expect(res.body.sessions[0].activity).toEqual({ working: true, waiting: false, event: "PreToolUse", workPhase: "implementing" });
  });

  it("does not otherwise change the session row shape (remote mobile's own wire contract)", async () => {
    const { app } = appFor();
    const res = await request(app).get("/api/mobile/terminal-sessions");
    const { activity, ...rest } = res.body.sessions[0];
    expect(rest).toEqual(SESSIONS[0]);
  });
});

describe("GET /api/mobile/terminal-sessions/:id/screen", () => {
  it("returns the existing SessionScreen shape plus styledScreen (#7)", async () => {
    const { app } = appFor();
    const res = await request(app).get(`/api/mobile/terminal-sessions/${LIVE}/screen`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...SCREEN, styledScreen: STYLED_ROWS });
  });

  it("400s an id that is not a session id", async () => {
    const { app } = appFor();
    const res = await request(app).get("/api/mobile/terminal-sessions/not-a-uuid/screen");
    expect(res.status).toBe(400);
  });

  it("404s a session the host does not know, without comparing error text", async () => {
    const { app } = appFor();
    const res = await request(app).get(`/api/mobile/terminal-sessions/${GONE}/screen`);
    expect(res.status).toBe(404);
  });

  it("never puts an internal stack in the response", async () => {
    const { app } = appFor({
      captureTerminalScreen: async () => {
        throw new Error("boom: unexpected failure deep in tmux capture");
      },
    });
    const res = await request(app).get(`/api/mobile/terminal-sessions/${LIVE}/screen`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to read terminal screen" });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js):\d+/);
  });

  // The plain-text screen above is already a real, successful capture by the time styling is
  // attempted — a failure building JUST the coloured rows must not turn that into a 500.
  it("degrades to the plain-text screen alone when captureStyledScreen throws", async () => {
    const { app } = appFor({
      captureStyledScreen: async () => {
        throw new Error("styling blew up");
      },
    });
    const res = await request(app).get(`/api/mobile/terminal-sessions/${LIVE}/screen`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SCREEN);
  });

  // captureTerminalScreen and captureStyledScreen are two INDEPENDENT reads of the same live
  // session (#7 round-3 review) — nothing makes them atomic, so an active repaint between the
  // two can pair a `screen` from one frame with `styledScreen` rows from a DIFFERENT frame. The
  // phone always prefers styled rows when present, so a mismatched pair must not reach it.
  it("degrades to the plain-text screen alone when styledScreen's text disagrees with screen.screen", async () => {
    const { app } = appFor({
      // Simulates a repaint landing between the two captures: this text was never on screen
      // at the same moment as SCREEN.screen.
      captureStyledScreen: async () => [[{ text: "a different frame entirely", fg: null, bg: null, bold: false }]],
    });
    const res = await request(app).get(`/api/mobile/terminal-sessions/${LIVE}/screen`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SCREEN);
  });

  // Ghost text can end in a no-break space (Claude Code's empty input box, screen-rows.ts's own
  // note) — `.trimEnd()` strips that along with plain ASCII space, so the consistency check must
  // apply the SAME trim to its reconstruction or a perfectly matching pair would be rejected for
  // a reason that isn't a capture race at all.
  it("does not treat a screen ending in a no-break space as a capture mismatch", async () => {
    const NBSP = String.fromCharCode(0xa0);
    const { app } = appFor({
      captureTerminalScreen: async () => ({ ...SCREEN, screen: `❯${NBSP}`.trimEnd() }), // what captureSessionScreen really sends
      captureStyledScreen: async () => [[{ text: `❯${NBSP}`, fg: null, bg: null, bold: false }]], // the untrimmed styled reconstruction
    });
    const res = await request(app).get(`/api/mobile/terminal-sessions/${LIVE}/screen`);
    expect(res.status).toBe(200);
    expect(res.body.styledScreen).toEqual([[{ text: "❯ ", fg: null, bg: null, bold: false }]]);
  });
});

describe("POST /api/mobile/terminal-sessions/:id/input", () => {
  it("sends through createTerminalInputSender — bracketed paste, not a raw PTY write", async () => {
    const { app, writes } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/input`).send({ text: "git status" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    expect(writes.map((w) => w.chunk)).toEqual([expect.stringContaining("git status"), "\r"]);
    expect(writes[0].chunk.startsWith("\x1b[200~")).toBe(true);
  });

  it("400s an id that is not a session id", async () => {
    const { app } = appFor();
    const res = await request(app).post("/api/mobile/terminal-sessions/not-a-uuid/input").send({ text: "x" });
    expect(res.status).toBe(400);
  });

  it("400s when text is not a string", async () => {
    const { app } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/input`).send({ text: 42 });
    expect(res.status).toBe(400);
  });

  it("400s text that sanitizes to empty", async () => {
    const { app, writes } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/input`).send({ text: "\x03\r\n" });
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("409s a tmux-only session with no live PTY to write to", async () => {
    const { app } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${TMUX_ONLY}/input`).send({ text: "ls" });
    expect(res.status).toBe(409);
  });

  it("403s a disallowed Origin without calling the sender", async () => {
    const { app, writes } = appFor({}, () => false);
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/input`).set("Origin", "https://evil.example").send({ text: "ls" });
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
  });

  // The existing contract in createTerminalInputSender (terminalInput.ts): two sends to the SAME
  // session chain, so the route must build exactly one sender for the whole mount rather than one
  // per request — a per-request sender would let both pastes land before either Enter.
  it("serializes two inputs to the same session rather than interleaving them", async () => {
    const { app, writes } = appFor();
    const [a, b] = await Promise.all([
      request(app).post(`/api/mobile/terminal-sessions/${LIVE}/input`).send({ text: "one" }),
      request(app).post(`/api/mobile/terminal-sessions/${LIVE}/input`).send({ text: "two" }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Whichever request's paste went first, its own "\r" must follow immediately — never
    // paste-A, paste-B, "\r", "\r".
    expect(writes).toHaveLength(4);
    expect(writes[1].chunk).toBe("\r");
    expect(writes[3].chunk).toBe("\r");
  });
});

describe("POST /api/mobile/terminal-sessions/:id/launch", () => {
  it("launches successfully via the injected function", async () => {
    const { app } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/launch`).send({ agent: "claude" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("400s an invalid agent", async () => {
    const { app } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/launch`).send({ agent: "not-an-agent" });
    expect(res.status).toBe(400);
  });

  it("400s an id that is not a session id", async () => {
    const { app } = appFor();
    const res = await request(app).post("/api/mobile/terminal-sessions/not-a-uuid/launch").send({ agent: "claude" });
    expect(res.status).toBe(400);
  });

  it("409s when no browser is open to receive the request", async () => {
    const { app } = appFor({ launchTerminal: () => ({ ok: false, error: NO_BROWSER_ERROR }) });
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/launch`).send({ agent: "claude" });
    expect(res.status).toBe(409);
  });

  it("409s when the session's cwd is unknown", async () => {
    const { app } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${NO_CWD}/launch`).send({ agent: "claude" });
    expect(res.status).toBe(409);
  });

  it("403s a disallowed Origin without calling launchTerminal", async () => {
    let called = false;
    const { app } = appFor(
      {
        launchTerminal: () => {
          called = true;
          return { ok: true };
        },
      },
      () => false,
    );
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/launch`).set("Origin", "https://evil.example").send({ agent: "claude" });
    expect(res.status).toBe(403);
    expect(called).toBe(false);
  });
});
