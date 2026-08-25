// @vitest-environment node
//
// The local mobile terminal route adapter. Every dependency here is a fake standing in for the
// same PTY/tmux access functions server/index.ts wires into production; this spec pins the route
// contract, while terminalScreen.spec.ts and terminalInput.spec.ts cover the lower-level helpers.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { localSessionActivity, mountLocalMobileTerminalRoutes, type LocalMobileTerminalRouteDeps } from "../../../server/routes/local-mobile-terminal-routes";
import { shellCommandCopyFromScreens } from "../../../common/shellCommandCopy";
import { TerminalSessionNotFoundError, type SessionScreen, type TerminalSessionSummary } from "../../../server/mobileTerminal/terminalScreen";
import { NO_BROWSER_ERROR } from "../../../server/mobileTerminal/launchTerminal";
import { isLaunchAgent, LAUNCH_AGENTS } from "../../../common/launchAgent";
import type { AnsiRow } from "../../../common/ansiStyle";
import type { MobileWebPushConfig } from "../../../server/mobile-web-push/config";
import type { MobileWebPushSubscriptionInput, MobileWebPushSubscriptionStore } from "../../../server/mobile-web-push/subscription-store";
import type { MobileWebPushSender } from "../../../server/mobile-web-push/sender";

const LIVE = randomUUID();
const TMUX_ONLY = randomUUID();
const GONE = randomUUID();
const NO_CWD = randomUUID();

// screen/STYLED_ROWS' text must agree byte for byte, matching what the route's consistency
// check (#7 round-3 review) requires of a real, same-capture pair — screen.screen is already
// `.trimEnd()`-ed by captureSessionScreen, so it must not end in trimmable whitespace either.
const SCREEN: SessionScreen = { screen: "$ echo", suggestion: "", quickCommands: [], cwd: "/home/user/project" };
const STYLED_ROWS: AnsiRow[] = [[{ text: "$ echo", fg: null, bg: null, bold: false }]];
const SESSIONS: TerminalSessionSummary[] = [{ id: LIVE, title: "one", cwd: "/home/user/project", live: true, inputAvailable: true, agent: "claude" }];
const IDLE_ACTIVITY = { working: false, waiting: false, event: null, workPhase: null };
const WEB_PUSH_CONFIG: MobileWebPushConfig = {
  enabled: true,
  vapid: { subject: "mailto:push@example.test", publicKey: "public-key", privateKey: "private-key" },
};
const WEB_PUSH_SUBSCRIPTION: MobileWebPushSubscriptionInput = {
  endpoint: "https://push.example/subscription",
  expirationTime: null,
  keys: { p256dh: "p256dh", auth: "auth" },
};

function mobileWebPushDeps(overrides: Partial<LocalMobileTerminalRouteDeps["mobileWebPush"]> = {}): LocalMobileTerminalRouteDeps["mobileWebPush"] {
  const subscriptions: MobileWebPushSubscriptionStore = {
    list: async () => [],
    upsert: async () => ({ created: true, count: 1 }),
    removeEndpoint: async () => ({ removed: true, count: 0 }),
    removeEndpoints: async (endpoints) => ({ removed: endpoints.length, count: 0 }),
  };
  const sender: MobileWebPushSender = {
    sendTest: async () => ({ ok: true, sent: 1, failed: 0, targets: 1, removed: 0 }),
    sendActivity: async () => ({ ok: true, sent: 1, failed: 0, targets: 1, removed: 0 }),
  };
  return { config: () => WEB_PUSH_CONFIG, subscriptions, sender, ...overrides };
}

function appFor(overrides: Partial<LocalMobileTerminalRouteDeps> = {}, isAllowedOrigin: LocalMobileTerminalRouteDeps["isAllowedOrigin"] = () => true) {
  const writes: Array<{ id: string; chunk: string }> = [];
  const waitingUpdates: Array<{ id: string; waiting: boolean; event: string | undefined }> = [];
  const stops: string[] = [];
  const viewed: string[] = [];
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
    interruptSession: async (id) => {
      writes.push({ id, chunk: "\x03" });
    },
    stopSession: async (id) => {
      stops.push(id);
    },
    deleteSession: async (id) => {
      stops.push(id);
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
    createTerminalAtCwd: async (agent) => {
      if (!isLaunchAgent(agent)) return { ok: false, error: `agent must be one of: ${LAUNCH_AGENTS.join(", ")}` };
      return { ok: true, sessionId: LIVE };
    },
    // Every session reads idle by default — the interesting cases override this per test.
    activityOf: () => ({ working: false, waiting: false, event: null }),
    workPhaseOf: () => null,
    setWaiting: (id, waiting, event) => {
      waitingUpdates.push({ id, waiting, event });
    },
    acknowledgeTerminalView: (id) => {
      viewed.push(id);
    },
    captureStyledScreen: async () => STYLED_ROWS,
    mobileWebPush: mobileWebPushDeps(),
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  mountLocalMobileTerminalRoutes(app, deps);
  return { app, writes, waitingUpdates, stops, viewed };
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

describe("shellCommandCopyFromScreens", () => {
  it("returns the prompt-bearing command and multiline output while dropping the next prompt", () => {
    expect(
      shellCommandCopyFromScreens("older\nuser@host:/repo$ ", "older\nuser@host:/repo$ printf 'a\\nb'\na\nb\nuser@host:/repo$ ", "printf 'a\\nb'"),
    ).toEqual({
      text: "user@host:/repo$ printf 'a\\nb'\na\nb",
    });
  });

  it("waits until the submitted command is visible before offering a copy block", () => {
    expect(shellCommandCopyFromScreens("user@host:/repo$ ", "user@host:/repo$ ", "git status")).toBeNull();
    expect(shellCommandCopyFromScreens("user@host:/repo$ ", "something else", "git status")).toBeNull();
  });

  it("returns null when the pre-send boundary has scrolled out of the captured window", () => {
    expect(shellCommandCopyFromScreens("before\nuser@host:/repo$ ", "later output\ngit status\nmore output\nuser@host:/repo$ ", "git status")).toBeNull();
  });

  it("drops a dynamic trailing prompt when it keeps the same prompt marker", () => {
    expect(shellCommandCopyFromScreens("old\nuser@host:/repo main$ ", "old\nuser@host:/repo main$ false\nfailed\nuser@host:/repo main ✘ $", "false")).toEqual({
      text: "user@host:/repo main$ false\nfailed",
    });
  });

  it("starts at the latest submitted command when a stale boundary spans two mobile sends", () => {
    expect(
      shellCommandCopyFromScreens(
        "old\nuser@host:/repo$ ",
        "old\nuser@host:/repo$ cd myproject\nuser@host:/repo/myproject$ ls\nREADME.md\npackage.json\nuser@host:/repo/myproject$ ",
        "ls",
      ),
    ).toEqual({ text: "user@host:/repo/myproject$ ls\nREADME.md\npackage.json" });
  });
});

describe("POST /api/mobile/terminal-sessions", () => {
  it("creates a terminal through the injected launch function with a normalized cwd", async () => {
    const calls: Array<{ agent: unknown; cwd: string }> = [];
    const cwd = `${process.cwd()}/`;
    const { app } = appFor({
      createTerminalAtCwd: async (agent, resolvedCwd) => {
        calls.push({ agent, cwd: resolvedCwd });
        return { ok: true, sessionId: TMUX_ONLY };
      },
    });
    const res = await request(app).post("/api/mobile/terminal-sessions").send({ agent: "codex", cwd });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, sessionId: TMUX_ONLY });
    expect(calls).toEqual([{ agent: "codex", cwd: process.cwd() }]);
  });

  it("400s an invalid agent without treating it as a shell command", async () => {
    let called = false;
    const { app } = appFor({
      createTerminalAtCwd: async () => {
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
      createTerminalAtCwd: async () => {
        called = true;
        return { ok: true, sessionId: LIVE };
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

  it("409s when the direct session start fails", async () => {
    const { app } = appFor({ createTerminalAtCwd: async () => ({ ok: false, error: "codex not found" }) });
    const res = await request(app).post("/api/mobile/terminal-sessions").send({ agent: "shell", cwd: process.cwd() });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "codex not found" });
  });

  it("403s a disallowed Origin without publishing", async () => {
    let called = false;
    const { app } = appFor(
      {
        createTerminalAtCwd: async () => {
          called = true;
          return { ok: true, sessionId: LIVE };
        },
      },
      () => false,
    );
    const res = await request(app).post("/api/mobile/terminal-sessions").set("Origin", "https://evil.example").send({ agent: "shell", cwd: process.cwd() });
    expect(res.status).toBe(403);
    expect(called).toBe(false);
  });
});

describe("GET /api/mobile/terminal-sessions", () => {
  it("adds an `activity` field to each session, normalized to idle when none is tracked", async () => {
    const { app, viewed } = appFor();
    const res = await request(app).get("/api/mobile/terminal-sessions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ home: expect.any(String), sessions: [{ ...SESSIONS[0], activity: IDLE_ACTIVITY }] });
    expect(viewed).toEqual([]);
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
    expect(res.body.home).toEqual(expect.any(String));
  });
});

describe("local mobile Web Push routes", () => {
  it("returns only public Web Push config to the mobile client", async () => {
    const { app } = appFor();
    const res = await request(app).get("/api/mobile/web-push/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, publicKey: "public-key" });
    expect(JSON.stringify(res.body)).not.toContain("private-key");
  });

  it("reports disabled Web Push without breaking terminal routes", async () => {
    const { app } = appFor({
      mobileWebPush: mobileWebPushDeps({
        config: () => ({ enabled: false, reason: "missing VAPID config" }),
      }),
    });
    const config = await request(app).get("/api/mobile/web-push/config");
    const sessions = await request(app).get("/api/mobile/terminal-sessions");
    expect(config.body).toEqual({ enabled: false, publicKey: null, reason: "missing VAPID config" });
    expect(sessions.status).toBe(200);
  });

  it("registers a valid PushSubscription without accepting a caller payload", async () => {
    const calls: MobileWebPushSubscriptionInput[] = [];
    const { app } = appFor({
      mobileWebPush: mobileWebPushDeps({
        subscriptions: {
          ...mobileWebPushDeps().subscriptions,
          upsert: async (subscription) => {
            calls.push(subscription);
            return { created: true, count: 1 };
          },
        },
      }),
    });
    const res = await request(app)
      .post("/api/mobile/web-push/subscriptions")
      .send({ subscription: WEB_PUSH_SUBSCRIPTION, title: "caller controlled", body: "not accepted" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, created: true, subscriptions: 1 });
    expect(calls).toEqual([WEB_PUSH_SUBSCRIPTION]);
  });

  it("updates a duplicate subscription endpoint", async () => {
    const { app } = appFor({
      mobileWebPush: mobileWebPushDeps({
        subscriptions: {
          ...mobileWebPushDeps().subscriptions,
          upsert: async () => ({ created: false, count: 1 }),
        },
      }),
    });
    const res = await request(app).post("/api/mobile/web-push/subscriptions").send({ subscription: WEB_PUSH_SUBSCRIPTION });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, created: false, subscriptions: 1 });
  });

  it("rejects malformed subscriptions before storing them", async () => {
    let called = false;
    const { app } = appFor({
      mobileWebPush: mobileWebPushDeps({
        subscriptions: {
          ...mobileWebPushDeps().subscriptions,
          upsert: async () => {
            called = true;
            return { created: true, count: 1 };
          },
        },
      }),
    });
    const res = await request(app)
      .post("/api/mobile/web-push/subscriptions")
      .send({ subscription: { endpoint: "http://push.example/not-https" } });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("unregisters by endpoint only", async () => {
    const calls: string[] = [];
    const { app } = appFor({
      mobileWebPush: mobileWebPushDeps({
        subscriptions: {
          ...mobileWebPushDeps().subscriptions,
          removeEndpoint: async (endpoint) => {
            calls.push(endpoint);
            return { removed: true, count: 0 };
          },
        },
      }),
    });
    const res = await request(app).delete("/api/mobile/web-push/subscriptions").send({ endpoint: WEB_PUSH_SUBSCRIPTION.endpoint, body: "ignored" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, removed: true, subscriptions: 0 });
    expect(calls).toEqual([WEB_PUSH_SUBSCRIPTION.endpoint]);
  });

  it("sends a fixed server-side test notification for the selected session", async () => {
    const calls: Array<string | null> = [];
    const { app } = appFor({
      mobileWebPush: mobileWebPushDeps({
        sender: {
          sendTest: async (sessionId) => {
            calls.push(sessionId);
            return { ok: true, sent: 1, failed: 0, targets: 2, removed: 1 };
          },
          sendActivity: async () => ({ ok: true, sent: 1, failed: 0, targets: 1, removed: 0 }),
        },
      }),
    });
    const res = await request(app).post("/api/mobile/web-push/test").send({ sessionId: LIVE, title: "ignored" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, sent: 1, failed: 0, targets: 2, removed: 1 });
    expect(calls).toEqual([LIVE]);
  });

  it("403s Web Push writes from a disallowed Origin", async () => {
    const { app } = appFor({}, () => false);
    const res = await request(app)
      .post("/api/mobile/web-push/subscriptions")
      .set("Origin", "https://evil.example")
      .send({ subscription: WEB_PUSH_SUBSCRIPTION });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/mobile/terminal-sessions/:id/screen", () => {
  it("returns the existing SessionScreen shape plus styledScreen (#7)", async () => {
    const { app, viewed } = appFor();
    const res = await request(app).get(`/api/mobile/terminal-sessions/${LIVE}/screen`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...SCREEN, styledScreen: STYLED_ROWS });
    expect(viewed).toEqual([LIVE]);
  });

  it("400s an id that is not a session id", async () => {
    const { app } = appFor();
    const res = await request(app).get("/api/mobile/terminal-sessions/not-a-uuid/screen");
    expect(res.status).toBe(400);
  });

  it("404s a session the host does not know, without comparing error text", async () => {
    const { app, viewed } = appFor();
    const res = await request(app).get(`/api/mobile/terminal-sessions/${GONE}/screen`);
    expect(res.status).toBe(404);
    expect(viewed).toEqual([]);
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

  it("adds a Shell-only lastCommandCopy after mobile input, using the pre-send screen as the command boundary", async () => {
    let screen: SessionScreen = { ...SCREEN, screen: "old\nuser@host:/repo$ " };
    const { app } = appFor({
      sessionAgent: () => "shell",
      captureTerminalScreen: async () => screen,
      captureStyledScreen: async () => [[{ text: screen.screen, fg: null, bg: null, bold: false }]],
    });

    await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/input`).send({ text: "printf 'a\\nb'" });
    screen = { ...SCREEN, screen: "old\nuser@host:/repo$ printf 'a\\nb'\na\nb\nuser@host:/repo$ " };

    const res = await request(app).get(`/api/mobile/terminal-sessions/${LIVE}/screen`);
    expect(res.status).toBe(200);
    expect(res.body.lastCommandCopy).toEqual({ text: "user@host:/repo$ printf 'a\\nb'\na\nb" });
  });

  it("does not add lastCommandCopy for agent sessions even after mobile input", async () => {
    let screen: SessionScreen = { ...SCREEN, screen: "❯ " };
    const { app } = appFor({
      sessionAgent: () => "claude",
      captureTerminalScreen: async () => screen,
      captureStyledScreen: async () => [[{ text: screen.screen, fg: null, bg: null, bold: false }]],
    });

    await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/input`).send({ text: "hello" });
    screen = { ...SCREEN, screen: "❯ hello\nreply" };

    const res = await request(app).get(`/api/mobile/terminal-sessions/${LIVE}/screen`);
    expect(res.status).toBe(200);
    expect(res.body.lastCommandCopy).toBeUndefined();
  });
});

describe("POST /api/mobile/terminal-sessions/:id/input", () => {
  it("sends through createTerminalInputSender — bracketed paste, not a raw PTY write", async () => {
    const { app, writes, waitingUpdates } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/input`).send({ text: "git status" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    expect(writes.map((w) => w.chunk)).toEqual([expect.stringContaining("git status"), "\r"]);
    expect(writes[0].chunk.startsWith("\x1b[200~")).toBe(true);
    expect(waitingUpdates).toEqual([{ id: LIVE, waiting: false, event: undefined }]);
  });

  it("keeps multiline input inside the bracketed paste before the submit sequence", async () => {
    const { app, writes } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/input`).send({ text: "one\ntwo\nthree" });
    expect(res.status).toBe(200);
    expect(writes.map((w) => w.chunk)).toEqual(["\x1b[200~one\ntwo\nthree\x1b[201~", "\r"]);
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
    const { app, waitingUpdates } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${TMUX_ONLY}/input`).send({ text: "ls" });
    expect(res.status).toBe(409);
    expect(waitingUpdates).toEqual([]);
  });

  it("accepts input for a tmux-only session when the injected writer adopts it", async () => {
    const adoptedWrites: Array<{ id: string; chunk: string }> = [];
    const { app, waitingUpdates } = appFor({
      writeToSession: (id, chunk) => {
        adoptedWrites.push({ id, chunk });
        return id === TMUX_ONLY;
      },
    });

    const res = await request(app).post(`/api/mobile/terminal-sessions/${TMUX_ONLY}/input`).send({ text: "ls" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    expect(adoptedWrites.map((write) => write.id)).toEqual([TMUX_ONLY, TMUX_ONLY]);
    expect(waitingUpdates).toEqual([{ id: TMUX_ONLY, waiting: false, event: undefined }]);
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

describe("POST /api/mobile/terminal-sessions/:id/interrupt", () => {
  it("sends Ctrl+C through the injected raw interrupt path, without reaping the session", async () => {
    const { app, writes, stops } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/interrupt`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ interrupted: true });
    expect(writes).toEqual([{ id: LIVE, chunk: "\x03" }]);
    expect(stops).toEqual([]);
  });

  it("interrupts only the targeted session", async () => {
    const other = randomUUID();
    const { app, writes } = appFor();
    await request(app).post(`/api/mobile/terminal-sessions/${other}/interrupt`);
    expect(writes).toEqual([{ id: other, chunk: "\x03" }]);
  });

  it("interrupts a Core session even when this process has no transient PTY", async () => {
    const { app } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${TMUX_ONLY}/interrupt`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ interrupted: true });
  });

  it("400s an id that is not a session id", async () => {
    const { app, writes } = appFor();
    const res = await request(app).post("/api/mobile/terminal-sessions/not-a-uuid/interrupt");
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("403s a disallowed Origin without interrupting", async () => {
    const { app, writes } = appFor({}, () => false);
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/interrupt`).set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
  });
});

describe("POST /api/mobile/terminal-sessions/:id/stop", () => {
  it("uses the injected stop lifecycle for only the targeted session", async () => {
    const { app, stops, writes } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/stop`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stopped: true });
    expect(stops).toEqual([LIVE]);
    expect(writes).toEqual([]);
  });

  it("treats an already stopped valid session id as a safe no-op", async () => {
    const { app, stops } = appFor();
    const res = await request(app).post(`/api/mobile/terminal-sessions/${GONE}/stop`);
    expect(res.status).toBe(200);
    expect(stops).toEqual([GONE]);
  });

  it("400s an id that is not a session id", async () => {
    const { app, stops } = appFor();
    const res = await request(app).post("/api/mobile/terminal-sessions/not-a-uuid/stop");
    expect(res.status).toBe(400);
    expect(stops).toEqual([]);
  });

  it("403s a disallowed Origin without stopping", async () => {
    const { app, stops } = appFor({}, () => false);
    const res = await request(app).post(`/api/mobile/terminal-sessions/${LIVE}/stop`).set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(stops).toEqual([]);
  });
});

describe("DELETE /api/mobile/terminal-sessions/:id", () => {
  it("deletes the same Core session id exposed by mobile", async () => {
    const { app, stops } = appFor();
    const res = await request(app).delete(`/api/mobile/terminal-sessions/${LIVE}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(stops).toEqual([LIVE]);
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
