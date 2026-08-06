// The local-mode counterpart of the phone's Firestore remote-host terminal view (#435, #445,
// #831) — same underlying session access, reached over a plain same-origin HTTP API instead of a
// Firestore command channel. Mounted only when MULMOTERMINAL_MOBILE_MODE=local (server/index.ts),
// exclusive with backends/remoteHost's mountRemoteHostRoutes.
//
// Every dependency here is one of the SAME functions server/index.ts already builds for the
// remote host adapter (remoteHostListTerminalSessions, remoteHostCaptureTerminalScreen, …) — this
// file is a second adapter over the same PTY access, never a reimplementation of it, and never a
// caller of the Firestore handler table. The one exception is captureStyledScreen (#7's ANSI
// colour layer): it reads the same tmux/PTY sources remoteHostCaptureTerminalScreen does, but is
// never handed to the Firestore remote-host adapter — see its own doc comment for why.
import type { Express, Request, Response } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import { requestBody } from "./requestBody.js";
import { requestOriginAllowed } from "./same-origin-guard.js";
import { messageOf } from "../errors.js";
import { isLaunchAgent } from "../../common/launchAgent.js";
import { createTerminalInputSender, sanitizeTerminalInput } from "../backends/remoteHost/terminalInput.js";
import { TerminalSessionNotFoundError } from "../backends/remoteHost/terminalScreen.js";
import type { RemoteHostHandlerDeps } from "../backends/remoteHost/handlers/deps.js";
import type { ActivityTriple } from "../session/activity-transition.js";
import type { WorkPhase } from "../session/workPhase.js";
import type { AnsiRow } from "../../common/ansiStyle.js";

// The local-only counterpart of remoteHost's Firestore SessionActivity doc (backends/remoteHost/
// sessionActivity.ts): same working/waiting/event/workPhase vocabulary, but every field is always
// present (never omitted the way the Firestore doc's optional ones are) — a shape a mobile client
// can read without optional chaining. Deliberately NOT added to TerminalSessionSummary or
// buildSessionList (backends/remoteHost/terminalScreen.ts): that type is remote mobile's wire
// contract too, and this field is local-only (see the route below for why).
export interface LocalSessionActivity extends ActivityTriple {
  workPhase: WorkPhase | null;
}

// Combines the two readers server/index.ts wires in (one per source: the `activity` map, the
// work-phase tracker) into the one field the route adds to each session row. Pure, so the mapping
// itself needs no Express/fake-session-table setup to test.
export const localSessionActivity = (activity: ActivityTriple, workPhase: WorkPhase | null): LocalSessionActivity => ({ ...activity, workPhase });

export type LocalMobileTerminalRouteDeps = Pick<
  RemoteHostHandlerDeps,
  "listTerminalSessions" | "captureTerminalScreen" | "writeToSession" | "canClearBox" | "submitSequence" | "sessionAgent" | "launchTerminal"
> & {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  // Working/waiting/event and the live-turn work phase, read from the SAME tables the desktop
  // roster and the remote host's Firestore mirror read (session/registry.js's `activity` map,
  // session/work-phase-tracker.js) — never a second copy of that state. Two readers rather than
  // one combined accessor because those are genuinely separate stores in server/index.ts; both
  // are already normalized (see normalizeActivity / workPhaseTracker.phaseOf), so a session
  // neither has ever heard from — a shell, a fresh launch, a tmux-only survivor of a restart —
  // answers false/false/null/null rather than the route reaching for globals of its own.
  activityOf: (sessionId: string) => ActivityTriple;
  workPhaseOf: (sessionId: string) => WorkPhase | null;
  // The colour layer (#7), local-only — see its definition in server/index.ts for why this is
  // a separate capture rather than a field on captureTerminalScreen's SessionScreen (that type
  // is remote mobile's Firestore wire shape too, which has no reader for this and a byte
  // ceiling this would eat into for no reason).
  captureStyledScreen: (sessionId: string) => Promise<AnsiRow[]>;
};

export function mountLocalMobileTerminalRoutes(app: Express, deps: LocalMobileTerminalRouteDeps): void {
  const {
    isAllowedOrigin,
    listTerminalSessions,
    captureTerminalScreen,
    writeToSession,
    canClearBox,
    submitSequence,
    sessionAgent,
    launchTerminal,
    activityOf,
    workPhaseOf,
    captureStyledScreen,
  } = deps;
  // One sender for the whole mount, so its per-session serialization (typeAndSubmit's chain in
  // terminalInput.ts) actually spans every request — mirrors the Remote Host adapter's own
  // createTerminalSessionHandlers (backends/remoteHost/handlers/terminalSession.ts), which builds
  // exactly one for the same reason. Never construct a second one per request.
  const sendInput = createTerminalInputSender({ writeToSession, canClearBox, submitSequence, sessionAgent });

  app.get("/api/mobile/terminal-sessions", async (_req: Request, res: Response) => {
    const sessions = await listTerminalSessions();
    // `activity` is joined in here, by id, rather than added to buildSessionList/
    // TerminalSessionSummary — see LocalSessionActivity's comment. remoteHostListTerminalSessions
    // (passed in as listTerminalSessions) is the SAME function the Firestore remote-host adapter
    // calls, and its return shape is remote mobile's wire contract too.
    res.json({ sessions: sessions.map((session) => ({ ...session, activity: localSessionActivity(activityOf(session.id), workPhaseOf(session.id)) })) });
  });

  app.get("/api/mobile/terminal-sessions/:id/screen", async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
    try {
      const screen = await captureTerminalScreen(id);
      // Styling is additive on top of the plain-text screen above, which already reflects
      // whatever real error there is (session gone, tmux down, …) via the catch below. A
      // failure building JUST the styled rows must not cost the phone the screen it already
      // has — it degrades to the plain-text display it has always had instead (#7's "an
      // incomplete/unsupported sequence must not break the screen" requirement, extended here
      // to "styling itself failing must not break the screen" either).
      let styledScreen: AnsiRow[] | undefined;
      try {
        styledScreen = await captureStyledScreen(id);
      } catch (err) {
        console.error("[api] GET /api/mobile/terminal-sessions/:id/screen failed to build styled rows:", err);
      }
      res.json(styledScreen ? { ...screen, styledScreen } : screen);
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
