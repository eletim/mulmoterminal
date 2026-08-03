export const TERMINAL_CONTROL_SOCKET_PATH = "/ws/control";
export const TERMINAL_CONTROL_DISCONNECT_GRACE_MS = 10_000;
export const TERMINAL_CONTROL_LABEL_MAX_LENGTH = 80;
export const TERMINAL_CONTROL_DEFAULT_LABEL = "Unknown device";

export const TERMINAL_CONTROL_IDENTIFY_EVENT = "control:identify";
export const TERMINAL_CONTROL_ACQUIRE_EVENT = "control:acquire";
export const TERMINAL_CONTROL_RELEASE_EVENT = "control:release";
export const TERMINAL_CONTROL_STATE_EVENT = "control:state";
export const TERMINAL_CONTROL_ERROR_EVENT = "control:error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TerminalControlIdentity {
  clientId: string;
  instanceId: string;
  label: string;
}

export interface TerminalControlOwnerView {
  label: string;
  connected: boolean;
  leaseExpiresAt: number | null;
}

export interface TerminalControlState {
  revision: number;
  serverTime: number;
  owner: TerminalControlOwnerView | null;
  isOwner: boolean;
}

export interface TerminalControlError {
  code: string;
  message: string;
}

export function isTerminalControlUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function normalizeTerminalControlLabel(value: unknown): string {
  const cleaned = Array.from(typeof value === "string" ? value : "")
    .filter((char) => !isControlChar(char))
    .join("")
    .trim();
  const truncated = Array.from(cleaned).slice(0, TERMINAL_CONTROL_LABEL_MAX_LENGTH).join("");
  return truncated === "" ? TERMINAL_CONTROL_DEFAULT_LABEL : truncated;
}

export function normalizeTerminalControlIdentity(value: unknown): TerminalControlIdentity | null {
  if (!isRecord(value)) return null;
  const { clientId, instanceId, label } = value;
  if (!isTerminalControlUuid(clientId) || !isTerminalControlUuid(instanceId)) return null;
  return { clientId, instanceId, label: normalizeTerminalControlLabel(label) };
}

export function isTerminalControlError(value: unknown): value is TerminalControlError {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

export function isTerminalControlState(value: unknown): value is TerminalControlState {
  if (!isRecord(value)) return false;
  const { revision, serverTime, owner, isOwner } = value;
  return isFiniteNumber(revision) && isFiniteNumber(serverTime) && isTerminalControlOwnerView(owner) && typeof isOwner === "boolean";
}

function isTerminalControlOwnerView(value: unknown): value is TerminalControlOwnerView | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const { label, connected, leaseExpiresAt } = value;
  return typeof label === "string" && typeof connected === "boolean" && (leaseExpiresAt === null || isFiniteNumber(leaseExpiresAt));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isControlChar(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
