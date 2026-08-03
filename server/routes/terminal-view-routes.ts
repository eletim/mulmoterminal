import type { Express, Request, Response } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import { TerminalSessionNotFoundError, type SessionScreen, type TerminalSessionSummary } from "../backends/remoteHost/terminalScreen.js";

export interface TerminalViewRouteDeps {
  listTerminalSessions: () => Promise<TerminalSessionSummary[]>;
  captureTerminalScreen: (sessionId: string) => Promise<SessionScreen>;
}

interface TerminalSessionsResponse {
  sessions: TerminalSessionSummary[];
}

interface ErrorResponse {
  error: string;
}

const terminalSessionsResponse = (sessions: TerminalSessionSummary[]): TerminalSessionsResponse => ({ sessions });
const errorResponse = (error: string): ErrorResponse => ({ error });

async function listTerminalSessions(_req: Request, res: Response, deps: TerminalViewRouteDeps): Promise<void> {
  res.set("Cache-Control", "no-store");
  try {
    res.json(terminalSessionsResponse(await deps.listTerminalSessions()));
  } catch (err) {
    console.error("[api] /api/terminal-sessions failed:", err);
    res.status(500).json(errorResponse("failed to list terminal sessions"));
  }
}

async function captureTerminalScreen(req: Request<{ id: string }>, res: Response, deps: TerminalViewRouteDeps): Promise<void> {
  res.set("Cache-Control", "no-store");
  const { id } = req.params;
  if (!SESSION_ID_RE.test(id)) {
    res.status(400).json(errorResponse("invalid session id"));
    return;
  }

  try {
    res.json(await deps.captureTerminalScreen(id));
  } catch (err) {
    if (err instanceof TerminalSessionNotFoundError) {
      res.status(404).json(errorResponse("terminal session not found"));
      return;
    }
    console.error("[api] /api/terminal-sessions/:id/screen failed:", err);
    res.status(500).json(errorResponse("failed to capture terminal screen"));
  }
}

export function mountTerminalViewRoutes(app: Express, deps: TerminalViewRouteDeps): void {
  app.get("/api/terminal-sessions", (req, res) => void listTerminalSessions(req, res, deps));
  app.get("/api/terminal-sessions/:id/screen", (req: Request<{ id: string }>, res) => void captureTerminalScreen(req, res, deps));
}
