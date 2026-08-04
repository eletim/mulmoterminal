// The local-mode counterpart of the phone's Firestore remote-host terminal view (#435, #445,
// #831) — same underlying session access, reached over a plain same-origin HTTP API instead of a
// Firestore command channel. Mounted only when MULMOTERMINAL_MOBILE_MODE=local (server/index.ts),
// exclusive with backends/remoteHost's mountRemoteHostRoutes.
//
// Every dependency here is one of the SAME functions server/index.ts already builds for the
// remote host adapter (remoteHostListTerminalSessions, remoteHostCaptureTerminalScreen, …) — this
// file is a second adapter over the same PTY access, never a reimplementation of it, and never a
// caller of the Firestore handler table.
import type { Express, Request, Response } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import { requestBody } from "./requestBody.js";
import { requestOriginAllowed } from "./same-origin-guard.js";
import { messageOf } from "../errors.js";
import { isLaunchAgent } from "../../common/launchAgent.js";
import { createTerminalInputSender, sanitizeTerminalInput } from "../backends/remoteHost/terminalInput.js";
import { TerminalSessionNotFoundError } from "../backends/remoteHost/terminalScreen.js";
import type { RemoteHostHandlerDeps } from "../backends/remoteHost/handlers/deps.js";

export type LocalMobileTerminalRouteDeps = Pick<
  RemoteHostHandlerDeps,
  "listTerminalSessions" | "captureTerminalScreen" | "writeToSession" | "canClearBox" | "submitSequence" | "sessionAgent" | "launchTerminal"
> & {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
};

export function mountLocalMobileTerminalRoutes(app: Express, deps: LocalMobileTerminalRouteDeps): void {
  const { isAllowedOrigin, listTerminalSessions, captureTerminalScreen, writeToSession, canClearBox, submitSequence, sessionAgent, launchTerminal } = deps;
  // One sender for the whole mount, so its per-session serialization (typeAndSubmit's chain in
  // terminalInput.ts) actually spans every request — mirrors the Remote Host adapter's own
  // createTerminalSessionHandlers (backends/remoteHost/handlers/terminalSession.ts), which builds
  // exactly one for the same reason. Never construct a second one per request.
  const sendInput = createTerminalInputSender({ writeToSession, canClearBox, submitSequence, sessionAgent });

  app.get("/api/mobile/terminal-sessions", async (_req: Request, res: Response) => {
    res.json({ sessions: await listTerminalSessions() });
  });

  app.get("/api/mobile/terminal-sessions/:id/screen", async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
    try {
      res.json(await captureTerminalScreen(id));
    } catch (err) {
      if (err instanceof TerminalSessionNotFoundError) return res.status(404).json({ error: "session not found" });
      console.error("[api] GET /api/mobile/terminal-sessions/:id/screen failed:", err);
      res.status(500).json({ error: "failed to read terminal screen" });
    }
  });

  app.post("/api/mobile/terminal-sessions/:id/input", async (req: Request<{ id: string }>, res: Response) => {
    if (!requestOriginAllowed(req, isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const { id } = req.params;
    if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
    const { text } = requestBody(req.body);
    // Checked here, against the SAME sanitizer sendInput uses internally, so an empty-after-
    // sanitize text is a 400 the caller can act on rather than a generic 500 — and so the only
    // way sendInput can still reject below is "no live terminal" (see the catch).
    if (typeof text !== "string" || !sanitizeTerminalInput(text)) return res.status(400).json({ error: "text is required" });
    try {
      res.json(await sendInput(id, text));
    } catch (err) {
      // tmux-only session, no PTY attached in this process (terminalInput.ts's typeAndSubmit).
      res.status(409).json({ error: messageOf(err) });
    }
  });

  app.post("/api/mobile/terminal-sessions/:id/launch", (req: Request<{ id: string }>, res: Response) => {
    if (!requestOriginAllowed(req, isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const { id } = req.params;
    if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
    // cwd is resolved server-side from `id` inside launchTerminal (decideLaunchTerminal) — the
    // phone never sends one (#831's rule, unchanged here).
    const { agent } = requestBody(req.body);
    const validAgent = isLaunchAgent(agent);
    const decision = launchTerminal(agent, id);
    if (!decision.ok) return res.status(validAgent ? 409 : 400).json({ error: decision.error });
    res.json({ ok: true });
  });
}
