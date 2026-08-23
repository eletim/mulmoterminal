// @vitest-environment node
// The /api/sessions/unplaced wire shape is what the desktop grid actually consumes. A registry
// unit test can prove "shell" is stored, but not that the HTTP route preserves it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { SessionRouteDeps } from "../../../server/routes/session-routes.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const promises = {
    ...actual.promises,
    readFile: vi.fn(async () => ""),
    appendFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  const existsSync = vi.fn(() => false);
  return { ...actual, existsSync, promises, default: { ...actual, existsSync, promises } };
});

const SHELL = "11111111-1111-1111-1111-111111111111";
const CODEX = "22222222-2222-2222-2222-222222222222";

async function appWithRegistry(over: Partial<SessionRouteDeps> = {}) {
  vi.resetModules();
  const registry = await import("../../../server/session/registry.js");
  const { mountSessionRoutes } = await import("../../../server/routes/session-routes.js");
  const app = express();
  mountSessionRoutes(app, { freshenRosterTitle: () => undefined, publishActivity: () => undefined, listTmuxIds: () => [], ...over });
  return { app, registry };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/sessions/unplaced", () => {
  it("preserves shell identity on the HTTP response consumed by the grid", async () => {
    const { app, registry } = await appWithRegistry();
    await Promise.all([registry.unplacedSessionsHydrated, registry.placedSessionsHydrated]);
    registry.markUnplacedSession(SHELL, "shell");
    registry.markUnplacedSession(CODEX, "codex");

    const res = await request(app).get("/api/sessions/unplaced");

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({
      sessions: [
        { id: SHELL, agent: "shell", cwd: null },
        { id: CODEX, agent: "codex", cwd: null },
      ],
    });
  });

  it("returns unplaced sessions through the SessionRecord placement view", async () => {
    const { app, registry } = await appWithRegistry();
    await Promise.all([registry.unplacedSessionsHydrated, registry.placedSessionsHydrated, registry.backgroundSessionsHydrated]);
    registry.markUnplacedSession(SHELL, "shell");
    registry.markUnplacedSession(CODEX, "codex");
    registry.backgroundMarkers.add(CODEX);

    const res = await request(app).get("/api/sessions/unplaced");

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ sessions: [{ id: SHELL, agent: "shell", cwd: null }] });
  });

  it("hydrates an unplaced tmux-only survivor with persisted cwd after restart", async () => {
    const { app, registry } = await appWithRegistry({
      listTmuxIds: () => [CODEX],
      paneCommandOf: () => "bash",
      claudeTranscriptExists: () => false,
    });
    await Promise.all([registry.unplacedSessionsHydrated, registry.placedSessionsHydrated, registry.devTerminalCwdsHydrated]);
    registry.markUnplacedSession(CODEX, "codex");
    registry.markDevTerminalSession(CODEX, "/repo/restarted");

    const res = await request(app).get("/api/sessions/unplaced");

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ sessions: [{ id: CODEX, agent: "codex", cwd: "/repo/restarted" }] });
  });
});
