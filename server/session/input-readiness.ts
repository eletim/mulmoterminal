import { claudeAdapter } from "../agents/claude.js";
import { isLoopbackAddress } from "../infra/loopback.js";
import { squashForMarker, trustDialogIsUp } from "./pty-scan.js";
import type { SessionAgent } from "../../common/sessionAgent.js";

export type TerminalSessionLifecycle = "starting" | "live" | "detached" | "stopped" | "failed";
export interface TerminalSessionRuntime {
  pty: boolean;
  tmux: boolean;
  attached: boolean;
}
export interface InputReadinessSession {
  agent: SessionAgent | null;
  lifecycle: TerminalSessionLifecycle;
  runtime: TerminalSessionRuntime;
  activity: { working: boolean; waiting: boolean };
}

export type InputReadinessSource = "shell" | "agent-marker" | "quiet" | "activity" | "unknown" | "unavailable";

export interface TrackedInputReadiness {
  ready: boolean;
  known: boolean;
  reason: string;
  source: InputReadinessSource;
  checkedAt: number | null;
}

export interface TerminalInputReadiness extends TrackedInputReadiness {
  available: boolean;
}

export interface InputReadinessTracker {
  markSessionLive: (sessionId: string, agent: SessionAgent) => void;
  noteOutput: (sessionId: string, agent: SessionAgent, data: string) => void;
  markSessionStopped: (sessionId: string) => void;
  stateOf: (sessionId: string) => TrackedInputReadiness | null;
}

const CODEX_READY_QUIET_MS = 1000;
const CLAUDE_READY_QUIET_MS = 6000;
const CLAUDE_TRUST_QUIET_MS = 60_000;
const CLAUDE_SETTLE_MS = 250;
const SCAN_TAIL_BYTES = 4096;

interface MutableReadinessState extends TrackedInputReadiness {
  agent: SessionAgent;
  scan: string;
  quiet: ReturnType<typeof setTimeout> | null;
}

function unknown(reason: string): TrackedInputReadiness {
  return { ready: false, known: false, reason, source: "unknown", checkedAt: null };
}

function ready(source: InputReadinessSource, reason: string): TrackedInputReadiness {
  return { ready: true, known: true, reason, source, checkedAt: Date.now() };
}

function notReady(source: InputReadinessSource, reason: string): TrackedInputReadiness {
  return { ready: false, known: true, reason, source, checkedAt: Date.now() };
}

function publicReadiness(state: TrackedInputReadiness): TrackedInputReadiness {
  const { ready: isReady, known, reason, source, checkedAt } = state;
  return { ready: isReady, known, reason, source, checkedAt };
}

function clearQuiet(state: MutableReadinessState): void {
  if (state.quiet) clearTimeout(state.quiet);
  state.quiet = null;
}

function setReady(
  states: Map<string, MutableReadinessState>,
  sessionId: string,
  state: MutableReadinessState,
  source: InputReadinessSource,
  reason: string,
): void {
  clearQuiet(state);
  Object.assign(state, ready(source, reason));
  states.set(sessionId, state);
}

function armQuiet(states: Map<string, MutableReadinessState>, sessionId: string, state: MutableReadinessState, ms: number, reason: string): void {
  clearQuiet(state);
  state.quiet = setTimeout(() => setReady(states, sessionId, state, "quiet", reason), ms);
}

function initialState(agent: SessionAgent): MutableReadinessState {
  return {
    agent,
    scan: "",
    quiet: null,
    ...(agent === "shell" ? ready("shell", "shell PTY accepts input once live") : notReady("unknown", "agent TUI has not reported input readiness")),
  };
}

function noteClaudeOutput(states: Map<string, MutableReadinessState>, sessionId: string, state: MutableReadinessState, data: string): void {
  state.scan = (state.scan + data).slice(-SCAN_TAIL_BYTES);
  const screen = squashForMarker(state.scan);
  if (claudeAdapter.draftReadyMarker.test(screen)) {
    state.scan = "";
    clearQuiet(state);
    state.quiet = setTimeout(() => setReady(states, sessionId, state, "agent-marker", "claude input marker painted"), CLAUDE_SETTLE_MS);
  } else if (trustDialogIsUp(screen)) {
    state.scan = "";
    Object.assign(state, notReady("agent-marker", "claude trust dialog is waiting"));
    armQuiet(states, sessionId, state, CLAUDE_TRUST_QUIET_MS, "claude trust dialog output settled");
  } else {
    armQuiet(states, sessionId, state, CLAUDE_READY_QUIET_MS, "claude startup output settled");
  }
}

export function createInputReadinessTracker(): InputReadinessTracker {
  const states = new Map<string, MutableReadinessState>();

  return {
    markSessionLive(sessionId, agent) {
      const current = states.get(sessionId);
      if (current?.ready && current.agent === agent) return;
      if (current) clearQuiet(current);
      states.set(sessionId, initialState(agent));
    },
    noteOutput(sessionId, agent, data) {
      const state = states.get(sessionId) ?? initialState(agent);
      state.agent = agent;
      if (state.ready) {
        states.set(sessionId, state);
        return;
      }
      if (agent === "codex") {
        armQuiet(states, sessionId, state, CODEX_READY_QUIET_MS, "codex startup output settled");
      } else if (agent === "claude") {
        noteClaudeOutput(states, sessionId, state, data);
      }
      states.set(sessionId, state);
    },
    markSessionStopped(sessionId) {
      const current = states.get(sessionId);
      if (current) clearQuiet(current);
      states.delete(sessionId);
    },
    stateOf(sessionId) {
      const state = states.get(sessionId);
      return state ? publicReadiness(state) : null;
    },
  };
}

function active(lifecycle: TerminalSessionLifecycle): boolean {
  return lifecycle === "starting" || lifecycle === "live" || lifecycle === "detached";
}

export function terminalInputAvailable(runtime: TerminalSessionRuntime): boolean {
  return runtime.pty || runtime.tmux;
}

export function terminalInputReadiness(record: InputReadinessSession, tracked: TrackedInputReadiness | null): TerminalInputReadiness {
  const available = terminalInputAvailable(record.runtime);
  if (!active(record.lifecycle)) {
    return { available, ...notReady("unavailable", `session lifecycle is ${record.lifecycle}`) };
  }
  if (!available) {
    return { available: false, ...notReady("unavailable", "no PTY or tmux runtime is available for input") };
  }
  if (record.activity.working) {
    return { available, ...notReady("activity", "agent is currently working") };
  }
  if (tracked?.ready) return { available, ...tracked };
  if (record.activity.waiting) {
    return { available, ...ready("activity", "session is waiting for user input") };
  }
  if (tracked) return { available, ...tracked };
  if (record.agent === "shell") {
    return { available, ...ready("shell", "shell runtime accepts terminal input") };
  }
  if (record.lifecycle === "detached" && !record.runtime.pty) {
    return { available, ...unknown("detached tmux survivor readiness is not observable until reattached") };
  }
  if (record.agent === null) {
    return { available, ...unknown("session agent is unknown") };
  }
  return { available, ...unknown(`${record.agent} readiness has not been observed`) };
}

export function sessionApiBearerToken(raw: string | string[] | undefined): string | null {
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== "string") return null;
  const trimmed = header.trim();
  const separator = trimmed.indexOf(" ");
  if (separator < 0 || trimmed.slice(0, separator).toLowerCase() !== "bearer") return null;
  const token = trimmed.slice(separator + 1).trim();
  return token || null;
}

export function localServerToServerAllowed(origin: string | undefined, remoteAddress: string | undefined): boolean {
  if (origin) return false;
  return remoteAddress === undefined || isLoopbackAddress(remoteAddress);
}
