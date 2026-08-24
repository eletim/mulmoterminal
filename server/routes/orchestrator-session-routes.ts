import type { Express, Request, Response } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import type { SessionAgent } from "../../common/sessionAgent.js";
import type { LaunchAgent } from "../../common/launchAgent.js";
import type { SessionRecord } from "../session/session-records.js";
import type { WorkPhase } from "../session/workPhase.js";
import { localServerToServerAllowed, sessionApiBearerToken, terminalInputReadiness, type TerminalInputReadiness } from "../session/input-readiness.js";
import {
  createTerminalSessionFromBody,
  createTerminalSessionInputSender,
  interruptTerminalSession,
  readTerminalSessionScreen,
  sendTerminalSessionInput,
  stopTerminalSession,
} from "../mobileTerminal/terminalSessionService.js";
import type { SessionScreen } from "../mobileTerminal/terminalScreen.js";

export interface OrchestratorSessionStatus {
  ok: true;
  sessionId: string;
  agent: SessionAgent | null;
  cwd: string | null;
  lifecycle: SessionRecord["lifecycle"];
  runtime: SessionRecord["runtime"];
  activity: SessionRecord["activity"] & { workPhase: WorkPhase | null };
  input: TerminalInputReadiness;
  inputAvailable: boolean;
  readyForInput: boolean;
}

export interface OrchestratorSessionRouteDeps {
  createTerminalAtCwd: (agent: LaunchAgent, cwd: string) => Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>;
  captureTerminalScreen: (sessionId: string) => Promise<SessionScreen>;
  writeToSession: (sessionId: string, chunk: string) => boolean;
  canClearBox: (sessionId: string) => boolean;
  submitSequence: (sessionId: string) => string;
  sessionAgent: (sessionId: string) => SessionAgent | undefined;
  setWaiting: (sessionId: string, waiting: boolean, event?: string) => void;
  interruptSession: (sessionId: string) => boolean;
  stopSession: (sessionId: string) => void;
  statusOf: (sessionId: string) => Promise<OrchestratorSessionStatus | null>;
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  apiToken?: string | undefined;
}

function configuredToken(deps: OrchestratorSessionRouteDeps): string | null {
  const token = deps.apiToken ?? process.env.MULMOTERMINAL_SESSION_API_TOKEN;
  return token && token.trim() ? token : null;
}

function authorized(req: Request, deps: OrchestratorSessionRouteDeps): boolean {
  const token = configuredToken(deps);
  const bearer = sessionApiBearerToken(req.headers.authorization);
  if (token) return bearer === token;
  if (req.headers.origin) return deps.isAllowedOrigin(req.headers.origin, req.socket?.remoteAddress);
  return localServerToServerAllowed(req.headers.origin, req.socket?.remoteAddress);
}

function rejectUnauthorized(req: Request, res: Response, deps: OrchestratorSessionRouteDeps): boolean {
  if (authorized(req, deps)) return false;
  res.status(configuredToken(deps) ? 401 : 403).json({ error: configuredToken(deps) ? "missing or invalid bearer token" : "forbidden session api client" });
  return true;
}

function readinessOnly(status: OrchestratorSessionStatus | null): { ready: boolean; reason: string } {
  if (!status) return { ready: false, reason: "session not found" };
  return { ready: status.readyForInput, reason: status.input.reason };
}

export function orchestratorSessionStatus(record: SessionRecord, workPhase: WorkPhase | null, input: TerminalInputReadiness): OrchestratorSessionStatus {
  return {
    ok: true,
    sessionId: record.id,
    agent: record.agent,
    cwd: record.cwd,
    lifecycle: record.lifecycle,
    runtime: record.runtime,
    activity: { ...record.activity, workPhase },
    input,
    inputAvailable: input.available,
    readyForInput: input.available && input.ready,
  };
}

export function inputReadinessForRecord(record: SessionRecord, tracked: Parameters<typeof terminalInputReadiness>[1]): TerminalInputReadiness {
  return terminalInputReadiness(record, tracked);
}

export function mountOrchestratorSessionRoutes(app: Express, deps: OrchestratorSessionRouteDeps): void {
  const sendInput = createTerminalSessionInputSender({
    writeToSession: deps.writeToSession,
    canClearBox: deps.canClearBox,
    submitSequence: deps.submitSequence,
    sessionAgent: deps.sessionAgent,
  });

  app.post("/api/sessions", async (req: Request, res: Response) => {
    if (rejectUnauthorized(req, res, deps)) return;
    const result = await createTerminalSessionFromBody(req.body, deps.createTerminalAtCwd);
    res.status(result.status).json(result.body);
  });

  app.get("/api/sessions/:id", async (req: Request<{ id: string }>, res: Response) => {
    if (rejectUnauthorized(req, res, deps)) return;
    const { id } = req.params;
    if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
    const status = await deps.statusOf(id);
    if (!status) return res.status(404).json({ error: "session not found" });
    res.json(status);
  });

  app.post("/api/sessions/:id/input", async (req: Request<{ id: string }>, res: Response) => {
    if (rejectUnauthorized(req, res, deps)) return;
    const result = await sendTerminalSessionInput(
      req.params.id,
      req.body,
      { captureTerminalScreen: deps.captureTerminalScreen, sendInput, sessionAgent: deps.sessionAgent, setWaiting: deps.setWaiting },
      { requireReady: async (id) => readinessOnly(await deps.statusOf(id)) },
    );
    res.status(result.status).json(result.body);
  });

  app.get("/api/sessions/:id/screen", async (req: Request<{ id: string }>, res: Response) => {
    if (rejectUnauthorized(req, res, deps)) return;
    const result = await readTerminalSessionScreen(req.params.id, deps.captureTerminalScreen);
    res.status(result.status).json(result.body);
  });

  app.post("/api/sessions/:id/interrupt", (req: Request<{ id: string }>, res: Response) => {
    if (rejectUnauthorized(req, res, deps)) return;
    const result = interruptTerminalSession(req.params.id, deps.interruptSession);
    res.status(result.status).json(result.body);
  });

  app.post("/api/sessions/:id/stop", (req: Request<{ id: string }>, res: Response) => {
    if (rejectUnauthorized(req, res, deps)) return;
    const result = stopTerminalSession(req.params.id, deps.stopSession);
    res.status(result.status).json(result.body);
  });
}
