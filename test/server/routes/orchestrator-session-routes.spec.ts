// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import {
  mountOrchestratorSessionRoutes,
  type OrchestratorSessionRouteDeps,
  type OrchestratorSessionStatus,
} from "../../../server/routes/orchestrator-session-routes";
import type { SessionScreen } from "../../../server/mobileTerminal/terminalScreen";

const ID = randomUUID();
const SCREEN: SessionScreen = { screen: "$ echo ready", suggestion: "", quickCommands: [], cwd: "/work/project" };

const READY_STATUS: OrchestratorSessionStatus = {
  ok: true,
  sessionId: ID,
  agent: "codex",
  cwd: "/work/project",
  lifecycle: "live",
  runtime: { pty: true, tmux: true, attached: false },
  activity: { working: false, waiting: false, event: null, at: null, workPhase: null },
  input: { available: true, ready: true, known: true, reason: "codex startup output settled", source: "quiet", checkedAt: 1 },
  inputAvailable: true,
  readyForInput: true,
};

function appFor(overrides: Partial<OrchestratorSessionRouteDeps> = {}) {
  const writes: Array<{ id: string; chunk: string }> = [];
  const stops: string[] = [];
  const waiting: Array<{ id: string; value: boolean }> = [];
  const deps: OrchestratorSessionRouteDeps = {
    createTerminalAtCwd: async () => ({ ok: true, sessionId: ID }),
    captureTerminalScreen: async () => SCREEN,
    writeToSession: (id, chunk) => {
      writes.push({ id, chunk });
      return true;
    },
    canClearBox: () => false,
    submitSequence: () => "\r",
    sessionAgent: () => "codex",
    setWaiting: (id, value) => waiting.push({ id, value }),
    interruptSession: (id) => {
      writes.push({ id, chunk: "\x03" });
      return true;
    },
    stopSession: (id) => {
      stops.push(id);
    },
    statusOf: async () => READY_STATUS,
    isAllowedOrigin: () => true,
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  mountOrchestratorSessionRoutes(app, deps);
  return { app, writes, stops, waiting };
}

describe("orchestrator session routes", () => {
  it("creates a terminal session at a cwd", async () => {
    const { app } = appFor();
    const res = await request(app).post("/api/sessions").send({ agent: "codex", cwd: process.cwd() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, sessionId: ID });
  });

  it("reports lifecycle, runtime, activity and input readiness", async () => {
    const { app } = appFor();
    const res = await request(app).get(`/api/sessions/${ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sessionId: ID,
      agent: "codex",
      cwd: "/work/project",
      lifecycle: "live",
      runtime: { pty: true, tmux: true, attached: false },
      activity: { working: false, waiting: false, workPhase: null },
      inputAvailable: true,
      readyForInput: true,
    });
  });

  it("rejects input until readiness says the session can accept it", async () => {
    const notReady = {
      ...READY_STATUS,
      input: { ...READY_STATUS.input, ready: false, reason: "agent TUI has not reported input readiness" },
      readyForInput: false,
    };
    const { app, writes } = appFor({ statusOf: async () => notReady });
    const res = await request(app).post(`/api/sessions/${ID}/input`).send({ text: "run this" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "session is not ready for input", reason: "agent TUI has not reported input readiness" });
    expect(writes).toEqual([]);
  });

  it("sends input using the shared terminal sender once ready", async () => {
    const { app, writes, waiting } = appFor();
    const res = await request(app).post(`/api/sessions/${ID}/input`).send({ text: "run this" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    expect(writes.map((w) => w.id)).toEqual([ID, ID]);
    expect(writes[0]?.chunk).toContain("run this");
    expect(waiting).toEqual([{ id: ID, value: false }]);
  });

  it("returns screen and exposes interrupt/stop operations", async () => {
    const { app, writes, stops } = appFor();
    await expect(request(app).get(`/api/sessions/${ID}/screen`)).resolves.toMatchObject({ status: 200, body: SCREEN });
    await expect(request(app).post(`/api/sessions/${ID}/interrupt`)).resolves.toMatchObject({ status: 200, body: { interrupted: true } });
    await expect(request(app).post(`/api/sessions/${ID}/stop`)).resolves.toMatchObject({ status: 200, body: { stopped: true } });
    expect(writes).toContainEqual({ id: ID, chunk: "\x03" });
    expect(stops).toEqual([ID]);
  });

  it("does not accept a disallowed browser Origin as a server-to-server client", async () => {
    const { app } = appFor({ isAllowedOrigin: () => false });
    const res = await request(app).post("/api/sessions").set("Origin", "https://evil.example").send({ agent: "shell", cwd: process.cwd() });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "forbidden session api client" });
  });

  it("requires bearer auth when a session API token is configured", async () => {
    const { app } = appFor({ apiToken: "secret" });
    await expect(request(app).get(`/api/sessions/${ID}`)).resolves.toMatchObject({ status: 401 });
    await expect(request(app).get(`/api/sessions/${ID}`).set("Authorization", "Bearer secret")).resolves.toMatchObject({ status: 200 });
  });
});
