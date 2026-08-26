// Local mobile terminal view (#435, #445, #831): a same-origin HTTP API over the same PTY/tmux
// access used by the desktop grid.
import type { Express, Request, Response } from "express";
import os from "node:os";
import { SESSION_ID_RE } from "../config/env.js";
import { requestBody } from "./requestBody.js";
import { requestOriginAllowed } from "./same-origin-guard.js";
import { isLaunchAgent, type LaunchAgent } from "../../common/launchAgent.js";
import { sanitizeTerminalInput } from "../mobileTerminal/terminalInput.js";
import { TerminalSessionNotFoundError } from "../mobileTerminal/terminalScreen.js";
import type { ActivityTriple } from "../session/activity-transition.js";
import type { WorkPhase } from "../session/workPhase.js";
import type { AnsiRow } from "../../common/ansiStyle.js";
import type { SessionAgent } from "../../common/sessionAgent.js";
import { publicMobileWebPushConfig, type MobileWebPushConfig } from "../mobile-web-push/config.js";
import { parseMobileWebPushSubscription, type MobileWebPushSubscriptionStore } from "../mobile-web-push/subscription-store.js";
import type { MobileWebPushSender } from "../mobile-web-push/sender.js";
import type { SessionScreen, TerminalSessionSummary } from "../mobileTerminal/terminalScreen.js";
import { shellCommandCopyFromScreens } from "../../common/shellCommandCopy.js";
import {
  createTerminalSessionFromBody,
  createTerminalSessionInputSender,
  deleteTerminalSession,
  interruptTerminalSession,
  readTerminalSessionScreen,
  resolveStyledScreen,
  sendTerminalSessionInput,
  stopTerminalSession,
  type PendingShellCommandCopy,
} from "../mobileTerminal/terminalSessionService.js";

// Local mobile activity payload: same working/waiting/event/workPhase vocabulary as the desktop
// roster, with every field present so the client can render it without optional chaining.
export interface LocalSessionActivity extends ActivityTriple {
  workPhase: WorkPhase | null;
}

// Combines the two readers server/index.ts wires in (one per source: the `activity` map, the
// work-phase tracker) into the one field the route adds to each session row. Pure, so the mapping
// itself needs no Express/fake-session-table setup to test.
export const localSessionActivity = (activity: ActivityTriple, workPhase: WorkPhase | null): LocalSessionActivity => ({ ...activity, workPhase });

export interface LocalMobileTerminalRouteDeps {
  listTerminalSessions: () => Promise<TerminalSessionSummary[]>;
  captureTerminalScreen: (sessionId: string) => Promise<SessionScreen>;
  acknowledgeTerminalView?: (sessionId: string) => void;
  writeToSession: (sessionId: string, chunk: string) => boolean | Promise<boolean>;
  interruptSession: (sessionId: string) => Promise<void>;
  stopSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  canClearBox: (sessionId: string) => boolean;
  submitSequence: (sessionId: string) => string | Promise<string>;
  sessionAgent: (sessionId: string) => SessionAgent | undefined | Promise<SessionAgent | undefined>;
  launchTerminal: (agent: unknown, sessionId: unknown) => { ok: true } | { ok: false; error: string };
  createTerminalAtCwd: (agent: LaunchAgent, cwd: string) => Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>;
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  // Working/waiting/event and the live-turn work phase, read from the SAME tables the desktop
  // roster reads (session/registry.js's `activity` map,
  // session/work-phase-tracker.js) — never a second copy of that state. Two readers rather than
  // one combined accessor because those are genuinely separate stores in server/index.ts; both
  // are already normalized (see normalizeActivity / workPhaseTracker.phaseOf), so a session
  // neither has ever heard from — a shell, a fresh launch, a tmux-only survivor of a restart —
  // answers false/false/null/null rather than the route reaching for globals of its own.
  activityOf: (sessionId: string) => ActivityTriple;
  workPhaseOf: (sessionId: string) => WorkPhase | null;
  setWaiting: (sessionId: string, waiting: boolean, event?: string) => void;
  // The colour layer (#7), local-only — see its definition in server/index.ts for why this is
  // a separate capture rather than a field on captureTerminalScreen's SessionScreen, keeping the
  // plain response compact for clients that do not read styled rows.
  captureStyledScreen: (sessionId: string) => Promise<AnsiRow[]>;
  mobileWebPush: {
    config: () => MobileWebPushConfig;
    subscriptions: MobileWebPushSubscriptionStore;
    sender: MobileWebPushSender;
  };
}

function mountCreateTerminalRoute(
  app: Express,
  isAllowedOrigin: LocalMobileTerminalRouteDeps["isAllowedOrigin"],
  createTerminalAtCwd: LocalMobileTerminalRouteDeps["createTerminalAtCwd"],
) {
  app.post("/api/mobile/terminal-sessions", async (req: Request, res: Response) => {
    if (!requestOriginAllowed(req, isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const result = await createTerminalSessionFromBody(req.body, createTerminalAtCwd);
    res.status(result.status).json(result.body);
  });
}

function webPushConfigured(config: MobileWebPushConfig, res: Response): config is Extract<MobileWebPushConfig, { enabled: true }> {
  if (config.enabled) return true;
  res.status(503).json({ error: config.reason });
  return false;
}

function mountMobileWebPushRoutes(
  app: Express,
  isAllowedOrigin: LocalMobileTerminalRouteDeps["isAllowedOrigin"],
  mobileWebPush: LocalMobileTerminalRouteDeps["mobileWebPush"],
) {
  app.get("/api/mobile/web-push/config", (_req: Request, res: Response) => {
    res.json(publicMobileWebPushConfig(mobileWebPush.config()));
  });

  app.post("/api/mobile/web-push/subscriptions", async (req: Request, res: Response) => {
    if (!requestOriginAllowed(req, isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    if (!webPushConfigured(mobileWebPush.config(), res)) return;
    const { subscription } = requestBody(req.body);
    const parsed = parseMobileWebPushSubscription(subscription);
    if (!parsed) return res.status(400).json({ error: "subscription is invalid" });
    const result = await mobileWebPush.subscriptions.upsert(parsed);
    res.json({ ok: true, created: result.created, subscriptions: result.count });
  });

  app.delete("/api/mobile/web-push/subscriptions", async (req: Request, res: Response) => {
    if (!requestOriginAllowed(req, isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const { endpoint } = requestBody(req.body);
    if (typeof endpoint !== "string" || endpoint.trim() === "") return res.status(400).json({ error: "endpoint is required" });
    const result = await mobileWebPush.subscriptions.removeEndpoint(endpoint);
    res.json({ ok: true, removed: result.removed, subscriptions: result.count });
  });

  app.post("/api/mobile/web-push/test", async (req: Request, res: Response) => {
    if (!requestOriginAllowed(req, isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const { sessionId } = requestBody(req.body);
    const id = sessionId === undefined || sessionId === null ? null : sessionId;
    if (id !== null && (typeof id !== "string" || !SESSION_ID_RE.test(id))) return res.status(400).json({ error: "invalid session id" });
    const result = await mobileWebPush.sender.sendTest(id);
    if (!result.ok) return res.status(503).json({ error: result.reason });
    res.json(result);
  });
}

interface InputRouteDeps {
  isAllowedOrigin: LocalMobileTerminalRouteDeps["isAllowedOrigin"];
  sendInput: ReturnType<typeof createTerminalSessionInputSender>;
  captureTerminalScreen: LocalMobileTerminalRouteDeps["captureTerminalScreen"];
  sessionAgent: (sessionId: string) => SessionAgent | undefined | Promise<SessionAgent | undefined>;
  setWaiting: LocalMobileTerminalRouteDeps["setWaiting"];
  pendingShellCommandCopies: Map<string, PendingShellCommandCopy>;
}

function mountInputRoute(app: Express, deps: InputRouteDeps) {
  app.post("/api/mobile/terminal-sessions/:id/input", async (req: Request<{ id: string }>, res: Response) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const { id } = req.params;
    if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
    const { text } = requestBody(req.body);
    // Checked here, against the SAME sanitizer sendInput uses internally, so an empty-after-
    // sanitize text is a 400 the caller can act on rather than a generic 500 — and so the only
    // way sendInput can still reject below is "no live terminal" (see the catch).
    if (typeof text !== "string") return res.status(400).json({ error: "text is required" });
    const safe = sanitizeTerminalInput(text);
    if (!safe) return res.status(400).json({ error: "text is required" });
    const result = await sendTerminalSessionInput(
      id,
      req.body,
      { captureTerminalScreen: deps.captureTerminalScreen, sendInput: deps.sendInput, sessionAgent: deps.sessionAgent, setWaiting: deps.setWaiting },
      { onShellCommand: (sessionId, copy) => deps.pendingShellCommandCopies.set(sessionId, copy) },
    );
    res.status(result.status).json(result.body);
  });
}

function mountSessionOperationRoutes(
  app: Express,
  isAllowedOrigin: LocalMobileTerminalRouteDeps["isAllowedOrigin"],
  interruptSession: LocalMobileTerminalRouteDeps["interruptSession"],
  stopSession: LocalMobileTerminalRouteDeps["stopSession"],
  deleteSession: LocalMobileTerminalRouteDeps["deleteSession"],
) {
  app.post("/api/mobile/terminal-sessions/:id/interrupt", async (req: Request<{ id: string }>, res: Response) => {
    if (!requestOriginAllowed(req, isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const { id } = req.params;
    const result = await interruptTerminalSession(id, interruptSession);
    res.status(result.status).json(result.body);
  });

  app.post("/api/mobile/terminal-sessions/:id/stop", async (req: Request<{ id: string }>, res: Response) => {
    if (!requestOriginAllowed(req, isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const { id } = req.params;
    const result = await stopTerminalSession(id, stopSession);
    res.status(result.status).json(result.body);
  });
  app.delete("/api/mobile/terminal-sessions/:id", async (req: Request<{ id: string }>, res: Response) => {
    if (!requestOriginAllowed(req, isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const result = await deleteTerminalSession(req.params.id, deleteSession);
    res.status(result.status).json(result.body);
  });
}

function mountScreenRoute(
  app: Express,
  deps: Pick<LocalMobileTerminalRouteDeps, "captureTerminalScreen" | "acknowledgeTerminalView" | "captureStyledScreen" | "sessionAgent">,
  pendingShellCommandCopies: Map<string, PendingShellCommandCopy>,
) {
  app.get("/api/mobile/terminal-sessions/:id/screen", async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
    try {
      const screenResult = await readTerminalSessionScreen(id, deps.captureTerminalScreen);
      if (screenResult.status !== 200) return res.status(screenResult.status).json(screenResult.body);
      const screen = screenResult.body;
      deps.acknowledgeTerminalView?.(id);
      // Styling is additive on top of the plain-text screen above, which already reflects
      // whatever real error there is (session gone, tmux down, …) via the catch below — a
      // failure or a mismatch resolving styled rows must not cost the phone the screen it
      // already has (resolveStyledScreen's own comment covers both cases).
      const styledScreen = await resolveStyledScreen(id, screen, deps.captureStyledScreen);
      const pendingCopy = (await deps.sessionAgent(id)) === "shell" ? pendingShellCommandCopies.get(id) : undefined;
      const lastCommandCopy = pendingCopy ? shellCommandCopyFromScreens(pendingCopy.beforeScreen, screen.screen, pendingCopy.command) : null;
      res.json({
        ...screen,
        ...(styledScreen ? { styledScreen } : {}),
        ...(lastCommandCopy ? { lastCommandCopy } : {}),
      });
    } catch (err) {
      if (err instanceof TerminalSessionNotFoundError) return res.status(404).json({ error: "session not found" });
      console.error("[api] GET /api/mobile/terminal-sessions/:id/screen failed:", err);
      res.status(500).json({ error: "failed to read terminal screen" });
    }
  });
}

function mountLaunchRoute(
  app: Express,
  isAllowedOrigin: LocalMobileTerminalRouteDeps["isAllowedOrigin"],
  launchTerminal: LocalMobileTerminalRouteDeps["launchTerminal"],
) {
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

export function mountLocalMobileTerminalRoutes(app: Express, deps: LocalMobileTerminalRouteDeps): void {
  const {
    isAllowedOrigin,
    listTerminalSessions,
    captureTerminalScreen,
    writeToSession,
    interruptSession,
    stopSession,
    deleteSession,
    canClearBox,
    submitSequence,
    sessionAgent,
    launchTerminal,
    createTerminalAtCwd,
    activityOf,
    workPhaseOf,
    setWaiting,
    acknowledgeTerminalView = () => undefined,
    captureStyledScreen,
    mobileWebPush,
  } = deps;
  // One sender for the whole mount, so its per-session serialization (typeAndSubmit's chain in
  // terminalInput.ts) actually spans every request — mirrors the Remote Host adapter's own
  // Never construct a second sender per request; the sender carries per-session serialization.
  const sendInput = createTerminalSessionInputSender({ writeToSession, canClearBox, submitSequence, sessionAgent });
  const pendingShellCommandCopies = new Map<string, PendingShellCommandCopy>();

  app.get("/api/mobile/terminal-sessions", async (_req: Request, res: Response) => {
    const sessions = await listTerminalSessions();
    // `activity` is joined in here, by id, rather than added to buildSessionList/
    // TerminalSessionSummary — see LocalSessionActivity's comment.
    res.json({
      home: os.homedir(),
      sessions: sessions.map((session) => ({ ...session, activity: localSessionActivity(activityOf(session.id), workPhaseOf(session.id)) })),
    });
  });

  mountCreateTerminalRoute(app, isAllowedOrigin, createTerminalAtCwd);
  mountMobileWebPushRoutes(app, isAllowedOrigin, mobileWebPush);
  mountInputRoute(app, { isAllowedOrigin, sendInput, captureTerminalScreen, sessionAgent, setWaiting, pendingShellCommandCopies });
  mountSessionOperationRoutes(app, isAllowedOrigin, interruptSession, stopSession, deleteSession);
  mountScreenRoute(app, { captureTerminalScreen, acknowledgeTerminalView, captureStyledScreen, sessionAgent }, pendingShellCommandCopies);
  mountLaunchRoute(app, isAllowedOrigin, launchTerminal);
}
