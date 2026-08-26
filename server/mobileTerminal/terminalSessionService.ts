import { LAUNCH_AGENTS, isLaunchAgent, type LaunchAgent } from "../../common/launchAgent.js";
import type { SessionAgent } from "../../common/sessionAgent.js";
import { workspaceRequest } from "../config/workspace.js";
import { messageOf } from "../errors.js";
import { ansiRowsToText } from "../session/ansiSegments.js";
import { SESSION_ID_RE } from "../config/env.js";
import { requestBody } from "../routes/requestBody.js";
import { createTerminalInputSender, sanitizeTerminalInput } from "./terminalInput.js";
import { TerminalSessionNotFoundError, type SessionScreen } from "./terminalScreen.js";
import type { AnsiRow } from "../../common/ansiStyle.js";

export interface PendingShellCommandCopy {
  command: string;
  beforeScreen: string;
}

export type TerminalRouteResult = { status: number; body: unknown };
type TerminalErrorResult = { status: 400 | 404 | 409 | 500; body: unknown };
type TerminalScreenResult = { status: 200; body: SessionScreen } | TerminalErrorResult;

export interface TerminalSessionServiceDeps {
  captureTerminalScreen: (sessionId: string) => Promise<SessionScreen>;
  writeToSession: (sessionId: string, chunk: string) => boolean | Promise<boolean>;
  canClearBox: (sessionId: string) => boolean | Promise<boolean>;
  submitSequence: (sessionId: string) => string | Promise<string>;
  sessionAgent: (sessionId: string) => SessionAgent | undefined | Promise<SessionAgent | undefined>;
  createTerminalAtCwd: (agent: LaunchAgent, cwd: string) => Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>;
  setWaiting: (sessionId: string, waiting: boolean, event?: string) => void;
}

export interface TerminalSessionInputOptions {
  requireReady?: ((sessionId: string) => Promise<{ ready: boolean; reason: string }>) | undefined;
  onShellCommand?: ((sessionId: string, copy: PendingShellCommandCopy) => void) | undefined;
}

export async function createTerminalSessionFromBody(
  body: unknown,
  createTerminalAtCwd: TerminalSessionServiceDeps["createTerminalAtCwd"],
): Promise<TerminalRouteResult> {
  const { agent, cwd } = requestBody(body);
  if (!isLaunchAgent(agent)) return { status: 400, body: { error: `agent must be one of: ${LAUNCH_AGENTS.join(", ")}` } };
  if (typeof cwd !== "string" || cwd.trim() === "") return { status: 400, body: { error: "cwd is required" } };
  const workspace = workspaceRequest(cwd);
  if (workspace.kind === "unusable") return { status: workspace.malformed ? 400 : 409, body: { error: workspace.problem } };

  const decision = await createTerminalAtCwd(agent, workspace.cwd);
  return decision.ok ? { status: 200, body: { ok: true, sessionId: decision.sessionId } } : { status: 409, body: { error: decision.error } };
}

export function createTerminalSessionInputSender(deps: Pick<TerminalSessionServiceDeps, "writeToSession" | "canClearBox" | "submitSequence" | "sessionAgent">) {
  return createTerminalInputSender(deps);
}

export async function sendTerminalSessionInput(
  id: string,
  body: unknown,
  deps: Pick<TerminalSessionServiceDeps, "captureTerminalScreen" | "sessionAgent" | "setWaiting"> & {
    sendInput: ReturnType<typeof createTerminalInputSender>;
  },
  options: TerminalSessionInputOptions = {},
): Promise<TerminalRouteResult> {
  if (!SESSION_ID_RE.test(id)) return { status: 400, body: { error: "invalid session id" } };
  const { text } = requestBody(body);
  if (typeof text !== "string") return { status: 400, body: { error: "text is required" } };
  const safe = sanitizeTerminalInput(text);
  if (!safe) return { status: 400, body: { error: "text is required" } };
  if (options.requireReady) {
    const readiness = await options.requireReady(id);
    if (!readiness.ready) return { status: 409, body: { error: "session is not ready for input", reason: readiness.reason } };
  }

  try {
    const beforeScreen = (await deps.sessionAgent(id)) === "shell" ? await deps.captureTerminalScreen(id).catch(() => null) : null;
    const result = await deps.sendInput(id, text);
    if (beforeScreen) options.onShellCommand?.(id, { command: safe, beforeScreen: beforeScreen.screen });
    deps.setWaiting(id, false);
    return { status: 200, body: result };
  } catch (err) {
    return { status: 409, body: { error: messageOf(err) } };
  }
}

export async function readTerminalSessionScreen(
  id: string,
  captureTerminalScreen: TerminalSessionServiceDeps["captureTerminalScreen"],
): Promise<TerminalScreenResult> {
  if (!SESSION_ID_RE.test(id)) return { status: 400, body: { error: "invalid session id" } };
  try {
    return { status: 200, body: await captureTerminalScreen(id) };
  } catch (err) {
    if (err instanceof TerminalSessionNotFoundError) return { status: 404, body: { error: "session not found" } };
    console.error("[api] failed to read terminal screen:", err);
    return { status: 500, body: { error: "failed to read terminal screen" } };
  }
}

export async function resolveStyledScreen(
  id: string,
  screen: { screen: string },
  captureStyledScreen: (sessionId: string) => Promise<AnsiRow[]>,
): Promise<AnsiRow[] | undefined> {
  try {
    const captured = await captureStyledScreen(id);
    return ansiRowsToText(captured).trimEnd() === screen.screen ? captured : undefined;
  } catch (err) {
    console.error("[api] failed to build styled terminal rows:", err);
    return undefined;
  }
}

export async function interruptTerminalSession(id: string, interruptSession: (sessionId: string) => Promise<void>): Promise<TerminalRouteResult> {
  if (!SESSION_ID_RE.test(id)) return { status: 400, body: { error: "invalid session id" } };
  try {
    await interruptSession(id);
    return { status: 200, body: { interrupted: true } };
  } catch (error) {
    return { status: 409, body: { error: messageOf(error) } };
  }
}

export async function stopTerminalSession(id: string, stopSession: (sessionId: string) => Promise<void>): Promise<TerminalRouteResult> {
  if (!SESSION_ID_RE.test(id)) return { status: 400, body: { error: "invalid session id" } };
  try {
    await stopSession(id);
    return { status: 200, body: { stopped: true } };
  } catch (error) {
    return { status: 409, body: { error: messageOf(error) } };
  }
}

export async function deleteTerminalSession(id: string, deleteSession: (sessionId: string) => Promise<void>): Promise<TerminalRouteResult> {
  if (!SESSION_ID_RE.test(id)) return { status: 400, body: { error: "invalid session id" } };
  try {
    await deleteSession(id);
    return { status: 200, body: { deleted: true } };
  } catch (error) {
    return { status: 409, body: { error: messageOf(error) } };
  }
}
