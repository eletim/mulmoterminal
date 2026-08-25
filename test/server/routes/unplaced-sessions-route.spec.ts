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
const CLAUDE = "33333333-3333-3333-3333-333333333333";

async function appWithRegistry(over: Partial<SessionRouteDeps> = {}) {
  vi.resetModules();
  const registry = await import("../../../server/session/registry.js");
  const lifecycle = await import("../../../server/session/session-lifecycle-records.js");
  const snapshot = await import("../../../server/session/session-record-snapshot.js");
  const { mountSessionRoutes } = await import("../../../server/routes/session-routes.js");
  const app = express();
  mountSessionRoutes(app, { freshenRosterTitle: () => undefined, publishActivity: () => undefined, listTmuxIds: () => [], ...over });
  return { app, lifecycle, registry, snapshot };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/sessions/unplaced", () => {
  it("preserves shell identity on the HTTP response consumed by the grid", async () => {
    const { app, lifecycle, registry } = await appWithRegistry();
    await Promise.all([registry.unplacedSessionsHydrated, registry.placedSessionsHydrated]);
    lifecycle.recordSessionStarting({ id: SHELL, agent: "shell", cwd: "/repo/shell" });
    lifecycle.recordSessionStarting({ id: CODEX, agent: "codex", cwd: "/repo/codex" });
    registry.markUnplacedSession(SHELL, "shell");
    registry.markUnplacedSession(CODEX, "codex");

    const res = await request(app).get("/api/sessions/unplaced");

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({
      sessions: [
        { id: SHELL, agent: "shell", cwd: "/repo/shell" },
        { id: CODEX, agent: "codex", cwd: "/repo/codex" },
      ],
    });
  });

  it("returns unplaced sessions through the SessionRecord placement view", async () => {
    const { app, lifecycle, registry } = await appWithRegistry();
    await Promise.all([registry.unplacedSessionsHydrated, registry.placedSessionsHydrated, registry.backgroundSessionsHydrated]);
    lifecycle.recordSessionStarting({ id: SHELL, agent: "shell", cwd: "/repo/shell" });
    lifecycle.recordSessionStarting({ id: CODEX, agent: "codex", cwd: "/repo/codex" });
    registry.markUnplacedSession(SHELL, "shell");
    registry.markUnplacedSession(CODEX, "codex");
    registry.backgroundMarkers.add(CODEX);

    const res = await request(app).get("/api/sessions/unplaced");

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ sessions: [{ id: SHELL, agent: "shell", cwd: "/repo/shell" }] });
  });

  it("does not return marker-only zombie sessions as unplaced", async () => {
    const { app, registry } = await appWithRegistry();
    await Promise.all([registry.unplacedSessionsHydrated, registry.placedSessionsHydrated, registry.backgroundSessionsHydrated]);
    registry.markUnplacedSession(SHELL, "shell");

    const res = await request(app).get("/api/sessions/unplaced");

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ sessions: [] });
  });

  it("hydrates an unplaced tmux-only survivor with persisted cwd after restart", async () => {
    const { app, registry } = await appWithRegistry({
      listTmuxIds: () => [CODEX],
      paneCommandOf: () => "bash",
      claudeTranscriptExists: () => false,
    });
    await Promise.all([registry.unplacedSessionsHydrated, registry.placedSessionsHydrated, registry.devTerminalCwdsHydrated]);
    registry.markUnplacedSession(CODEX, "codex", "/repo/restarted");

    const res = await request(app).get("/api/sessions/unplaced");

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ sessions: [{ id: CODEX, agent: "codex", cwd: "/repo/restarted" }] });
  });
});

describe("GET /api/sessions/grid-records", () => {
  it("answers PC grid cell existence from SessionRecord instead of local placement", async () => {
    const { app, lifecycle, registry } = await appWithRegistry();
    await registry.devTerminalSessionsHydrated;
    lifecycle.recordSessionLive({ id: SHELL, agent: "shell", cwd: "/repo/live", now: 10 });
    lifecycle.recordSessionStopped({ id: CODEX, agent: "codex", cwd: "/repo/stopped", now: 20 });
    registry.markDevTerminalSession(SHELL, "/repo/live");
    registry.markDevTerminalSession(CODEX, "/repo/stopped");

    const res = await request(app).get(`/api/sessions/grid-records?ids=${SHELL},${CODEX}`);

    expect(res.status, res.text).toBe(200);
    expect(res.body.sessions).toEqual([expect.objectContaining({ id: SHELL, agent: "shell", cwd: "/repo/live", lifecycle: "live", active: true })]);
  });

  it("does not promote an ordinary live chat into the PC terminal surface", async () => {
    const { app, lifecycle } = await appWithRegistry();
    lifecycle.recordSessionLive({ id: SHELL, agent: "claude", cwd: "/repo/chat", now: 10 });

    const res = await request(app).get(`/api/sessions/grid-records?ids=${SHELL}`);

    expect(res.status, res.text).toBe(200);
    expect(res.body.sessions).toEqual([]);
  });

  it("matches PC discovery to the canonical set used by Mobile", async () => {
    const { app, lifecycle, registry, snapshot } = await appWithRegistry();
    await snapshot.hydrateSessionRecordSnapshotInputs();

    lifecycle.recordSessionLive({ id: SHELL, agent: "shell", cwd: "/repo/grid", now: 10 });
    registry.ptys.set(SHELL, { cwd: "/repo/grid", agent: "shell", ws: null } as never);
    registry.markDevTerminalSession(SHELL, "/repo/grid");

    lifecycle.recordSessionLive({ id: CODEX, agent: "codex", cwd: "/repo/chat", now: 20 });
    registry.ptys.set(CODEX, { cwd: "/repo/chat", agent: "codex", ws: null } as never);

    lifecycle.recordSessionStarting({ id: CLAUDE, agent: "claude", cwd: "/repo/unplaced", now: 30 });
    registry.markUnplacedSession(CLAUDE, "claude", "/repo/unplaced");

    const [grid, unplaced] = await Promise.all([
      request(app).get(`/api/sessions/grid-records?ids=${SHELL},${CODEX}`),
      request(app).get("/api/sessions/unplaced"),
    ]);
    const pcIds = new Set([...grid.body.sessions, ...unplaced.body.sessions].map((row: { id: string }) => row.id));
    const canonicalIds = new Set(snapshot.currentTerminalSessionRecords().map((record) => record.id));
    const mobileIds = new Set(snapshot.currentTerminalSessionRecordSources().ids);

    expect(grid.status, grid.text).toBe(200);
    expect(unplaced.status, unplaced.text).toBe(200);
    expect(pcIds).toEqual(canonicalIds);
    expect(mobileIds).toEqual(canonicalIds);
    expect(canonicalIds).toEqual(new Set([SHELL, CLAUDE]));
  });

  it("hydrates tmux-only survivors for persisted PC grid cells after restart", async () => {
    const { app, registry } = await appWithRegistry({
      listTmuxIds: () => [CODEX],
      paneCommandOf: () => "codex",
      claudeTranscriptExists: () => false,
    });
    await Promise.all([registry.devTerminalSessionsHydrated, registry.devTerminalCwdsHydrated]);
    registry.markDevTerminalSession(CODEX, "/repo/restarted");

    const res = await request(app).get(`/api/sessions/grid-records?ids=${CODEX}`);

    expect(res.status, res.text).toBe(200);
    expect(res.body.sessions).toEqual([
      expect.objectContaining({
        id: CODEX,
        agent: "codex",
        cwd: "/repo/restarted",
        lifecycle: "detached",
        active: true,
        runtime: { pty: false, tmux: true, attached: false },
      }),
    ]);
  });
});
