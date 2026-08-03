import { isRecord } from "./isRecord.js";
import { isUnknownArray } from "./isUnknownArray.js";
import { isTerminalAgent, SESSION_AGENTS, type SessionAgent, type TerminalAgent } from "./sessionAgent.js";
import { isPrPhase, type PrPhase } from "./prPhase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isTerminalViewSessionId = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

export interface QuickCommandChip {
  label: string;
  text: string;
}

export interface SessionWorkSummary {
  pr: number | null;
  issue: number | null;
  phase: PrPhase;
  headline: string | null;
}

export type TerminalResumeTarget = { kind: "agent"; agent: TerminalAgent } | { kind: "launcher"; shell: true };

export interface TerminalSessionSummary {
  id: string;
  title: string;
  cwd: string;
  work?: SessionWorkSummary;
  live: boolean;
  agent: SessionAgent | null;
  resume: TerminalResumeTarget;
}

export interface SessionScreenMeta {
  cwd?: string;
  branch?: string;
  memo?: string;
  summary?: string;
  prompt?: string;
  githubUrl?: string;
}

export interface TerminalSessionScreen extends SessionScreenMeta {
  screen: string;
  suggestion: string;
  quickCommands: QuickCommandChip[];
}

export interface TerminalSessionsResponse {
  sessions: TerminalSessionSummary[];
}

const isSessionAgentOrNull = (value: unknown): value is SessionAgent | null =>
  value === null || (typeof value === "string" && SESSION_AGENTS.some((agent) => agent === value));

export const isQuickCommandChip = (value: unknown): value is QuickCommandChip =>
  isRecord(value) && typeof value.label === "string" && typeof value.text === "string";

export const isSessionWorkSummary = (value: unknown): value is SessionWorkSummary =>
  isRecord(value) &&
  (typeof value.pr === "number" || value.pr === null) &&
  (typeof value.issue === "number" || value.issue === null) &&
  isPrPhase(value.phase) &&
  (typeof value.headline === "string" || value.headline === null);

export const isTerminalResumeTarget = (value: unknown): value is TerminalResumeTarget => {
  if (!isRecord(value)) return false;
  if (value.kind === "launcher") return value.shell === true;
  return value.kind === "agent" && typeof value.agent === "string" && isTerminalAgent(value.agent);
};

export const resumeTargetForSessionAgent = (agent: SessionAgent | null): TerminalResumeTarget => {
  if (agent && isTerminalAgent(agent)) return { kind: "agent", agent };
  return { kind: "launcher", shell: true };
};

export const isTerminalSessionSummary = (value: unknown): value is TerminalSessionSummary => {
  if (!isRecord(value)) return false;
  if (!isTerminalViewSessionId(value.id)) return false;
  if (typeof value.title !== "string" || typeof value.cwd !== "string" || typeof value.live !== "boolean") return false;
  if (!isSessionAgentOrNull(value.agent)) return false;
  if (value.work !== undefined && !isSessionWorkSummary(value.work)) return false;
  return isTerminalResumeTarget(value.resume);
};

export const isTerminalSessionsResponse = (value: unknown): value is TerminalSessionsResponse =>
  isRecord(value) && isUnknownArray(value.sessions) && value.sessions.every(isTerminalSessionSummary);

const isOptionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === "string";

export const isTerminalSessionScreen = (value: unknown): value is TerminalSessionScreen =>
  isRecord(value) &&
  typeof value.screen === "string" &&
  typeof value.suggestion === "string" &&
  isUnknownArray(value.quickCommands) &&
  value.quickCommands.every(isQuickCommandChip) &&
  isOptionalString(value.cwd) &&
  isOptionalString(value.branch) &&
  isOptionalString(value.memo) &&
  isOptionalString(value.summary) &&
  isOptionalString(value.prompt) &&
  isOptionalString(value.githubUrl);
