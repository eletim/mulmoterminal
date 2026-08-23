import type { SessionAgent } from "../../common/sessionAgent.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../config/env.js";
import { messageOf } from "../errors.js";
import { parseSessionIdLog, sessionIdLogLine } from "./session-id-log.js";
import type { SessionRecordLifecycle } from "./session-records.js";

export interface SessionLifecycleRecord {
  id: string;
  lifecycle: SessionRecordLifecycle;
  agent: SessionAgent | null;
  cwd: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SessionLifecycleWrite {
  id: string;
  lifecycle: SessionRecordLifecycle;
  agent?: SessionAgent | null;
  cwd?: string | null;
  now?: number;
}

export const STOPPED_SESSION_LIFECYCLE_RECORD_LIMIT = 500;
const STOPPED_SESSION_LIFECYCLE_FILE = path.join(MULMOTERMINAL_HOME, "stopped-session-lifecycle.json");

export const sessionLifecycleRecords = new Map<string, SessionLifecycleRecord>();

export const sessionLifecycleRecordsHydrated = (async () => {
  try {
    const now = Date.now();
    for (const id of parseSessionIdLog(await fs.readFile(STOPPED_SESSION_LIFECYCLE_FILE, "utf8"), (value) => SESSION_ID_RE.test(value))) {
      if (!sessionLifecycleRecords.has(id)) {
        sessionLifecycleRecords.set(id, { id, lifecycle: "stopped", agent: null, cwd: null, createdAt: now, updatedAt: now });
      }
    }
  } catch {
    // absent on first run / unreadable => no durable stopped tombstones
  }
})();

let stoppedLifecyclePersist: Promise<void> = Promise.resolve();
function persistStoppedSessionLifecycle(id: string): void {
  if (!SESSION_ID_RE.test(id)) return;
  stoppedLifecyclePersist = stoppedLifecyclePersist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(STOPPED_SESSION_LIFECYCLE_FILE, sessionIdLogLine(id)))
    .catch((err) => console.error(`[session-lifecycle] failed to persist stopped ${id}: ${messageOf(err)}`));
}

function hasOwn(input: SessionLifecycleWrite, key: "agent" | "cwd"): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

export function pruneStoppedSessionLifecycleRecords(limit = STOPPED_SESSION_LIFECYCLE_RECORD_LIMIT): void {
  const stopped = [...sessionLifecycleRecords.values()].filter((record) => record.lifecycle === "stopped").sort((a, b) => a.updatedAt - b.updatedAt);
  for (const record of stopped.slice(0, Math.max(0, stopped.length - limit))) {
    sessionLifecycleRecords.delete(record.id);
  }
}

function writeLifecycle(input: SessionLifecycleWrite): SessionLifecycleRecord {
  const { id, lifecycle, now = Date.now() } = input;
  const current = sessionLifecycleRecords.get(id);
  const next: SessionLifecycleRecord = {
    id,
    lifecycle,
    agent: hasOwn(input, "agent") ? (input.agent ?? null) : (current?.agent ?? null),
    cwd: hasOwn(input, "cwd") ? (input.cwd ?? null) : (current?.cwd ?? null),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  sessionLifecycleRecords.set(id, next);
  if (lifecycle === "stopped") {
    if (current?.lifecycle !== "stopped") persistStoppedSessionLifecycle(id);
    pruneStoppedSessionLifecycleRecords();
  }
  return next;
}

export function recordSessionStarting(input: Omit<SessionLifecycleWrite, "lifecycle">): SessionLifecycleRecord {
  return writeLifecycle({ ...input, lifecycle: "starting" });
}

export function recordSessionLive(input: Omit<SessionLifecycleWrite, "lifecycle">): SessionLifecycleRecord {
  return writeLifecycle({ ...input, lifecycle: "live" });
}

export function recordSessionDetached(input: Omit<SessionLifecycleWrite, "lifecycle">): SessionLifecycleRecord {
  return writeLifecycle({ ...input, lifecycle: "detached" });
}

export function recordSessionStopped(input: Omit<SessionLifecycleWrite, "lifecycle">): SessionLifecycleRecord {
  return writeLifecycle({ ...input, lifecycle: "stopped" });
}

export function recordKnownSessionStopped(input: Omit<SessionLifecycleWrite, "lifecycle">): SessionLifecycleRecord | null {
  if (!sessionLifecycleRecords.has(input.id)) return null;
  return recordSessionStopped(input);
}

export function sessionLifecycleRecordRows(): SessionLifecycleRecord[] {
  return [...sessionLifecycleRecords.values()];
}
