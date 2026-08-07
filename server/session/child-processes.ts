import { spawnCapture } from "../infra/spawnCapture.js";
import { tmuxPanePid } from "../infra/tmux.js";
import type { PtyEntry } from "./types.js";

export interface ProcessRow {
  pid: number;
  ppid: number;
}

export function parsePsPidPpid(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid) && ppid >= 0) rows.push({ pid, ppid });
  }
  return rows;
}

export function hasDescendantProcess(rootPid: number, rows: readonly ProcessRow[]): boolean {
  return childProcessPids(rootPid, rows).size > 0;
}

export function childProcessPids(rootPid: number, rows: readonly ProcessRow[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const { pid, ppid } of rows) {
    const siblings = children.get(ppid);
    if (siblings) siblings.push(pid);
    else children.set(ppid, [pid]);
  }
  return new Set(children.get(rootPid) ?? []);
}

export function hasNewChildProcess(rootPid: number, rows: readonly ProcessRow[], baseline: ReadonlySet<number>): boolean {
  for (const pid of childProcessPids(rootPid, rows)) {
    if (!baseline.has(pid)) return true;
  }
  return false;
}

export function sessionRootPid(sessionId: string, entry: PtyEntry | undefined): number | null {
  if (entry?.tmux) return tmuxPanePid(sessionId);
  if (entry) return entry.term.pid;
  return tmuxPanePid(sessionId);
}

function processRows(): ProcessRow[] | null {
  if (process.platform === "win32") return null;
  const r = spawnCapture("ps", ["-eo", "pid=,ppid="]);
  return r.status === 0 ? parsePsPidPpid(r.stdout) : null;
}

export function hasSessionChildProcess(sessionId: string, entry: PtyEntry | undefined): boolean {
  const rootPid = sessionRootPid(sessionId, entry);
  if (rootPid === null) return false;
  const rows = processRows();
  return rows ? hasDescendantProcess(rootPid, rows) : false;
}

export function sessionChildProcessPids(sessionId: string, entry: PtyEntry | undefined): Set<number> | null {
  const rootPid = sessionRootPid(sessionId, entry);
  if (rootPid === null) return null;
  const rows = processRows();
  return rows ? childProcessPids(rootPid, rows) : null;
}

export function hasNewSessionChildProcess(sessionId: string, entry: PtyEntry | undefined, baseline: ReadonlySet<number> | null): boolean {
  if (baseline === null) return hasSessionChildProcess(sessionId, entry);
  const rootPid = sessionRootPid(sessionId, entry);
  if (rootPid === null) return false;
  const rows = processRows();
  return rows ? hasNewChildProcess(rootPid, rows, baseline) : false;
}
