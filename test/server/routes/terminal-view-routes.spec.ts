// @vitest-environment node
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TerminalSessionNotFoundError } from "../../../server/backends/remoteHost/terminalScreen.js";
import { mountTerminalViewRoutes, type TerminalViewRouteDeps } from "../../../server/routes/terminal-view-routes.js";
import type { TerminalSessionScreen as SessionScreen, TerminalSessionSummary } from "../../../common/terminalView.js";
import { appRequest } from "../../helpers/appRequest.js";

const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";

const summary: TerminalSessionSummary = {
  id: SESSION_ID,
  title: "Fix parser",
  cwd: "/repo",
  live: true,
  agent: "shell",
  resume: { kind: "launcher", shell: true },
};

const screen: SessionScreen = {
  screen: "hello",
  suggestion: "",
  quickCommands: [],
};

const appWith = (deps: Partial<TerminalViewRouteDeps> = {}) => {
  const app = express();
  mountTerminalViewRoutes(app, {
    listTerminalSessions: async () => [summary],
    captureTerminalScreen: async () => screen,
    ...deps,
  });
  return app;
};

describe("terminal view routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns terminal sessions with no-store caching", async () => {
    const res = await appRequest(appWith())("/api/terminal-sessions");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ sessions: [summary] });
  });

  it("passes the requested session id to the screen capture dependency with no-store caching", async () => {
    const captureTerminalScreen = vi.fn(async (): Promise<SessionScreen> => screen);
    const res = await appRequest(appWith({ captureTerminalScreen }))(`/api/terminal-sessions/${SESSION_ID}/screen`);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(screen);
    expect(captureTerminalScreen).toHaveBeenCalledWith(SESSION_ID);
  });

  it("rejects an invalid screen session id without calling capture", async () => {
    const captureTerminalScreen = vi.fn(async (): Promise<SessionScreen> => screen);
    const res = await appRequest(appWith({ captureTerminalScreen }))("/api/terminal-sessions/not-a-session/screen");

    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(captureTerminalScreen).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing terminal session without logging", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const captureTerminalScreen = vi.fn(async (): Promise<SessionScreen> => {
      throw new TerminalSessionNotFoundError(SESSION_ID);
    });

    const res = await appRequest(appWith({ captureTerminalScreen }))(`/api/terminal-sessions/${SESSION_ID}/screen`);

    expect(res.status).toBe(404);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns 500 and logs unexpected screen capture errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const captureTerminalScreen = vi.fn(async (): Promise<SessionScreen> => {
      throw new Error("tmux exploded");
    });

    const res = await appRequest(appWith({ captureTerminalScreen }))(`/api/terminal-sessions/${SESSION_ID}/screen`);

    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns 500 and logs unexpected list errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const listTerminalSessions = vi.fn(async (): Promise<TerminalSessionSummary[]> => {
      throw new Error("list exploded");
    });

    const res = await appRequest(appWith({ listTerminalSessions }))("/api/terminal-sessions");

    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
  });
});
