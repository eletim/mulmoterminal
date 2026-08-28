import { hasSessionChildProcess } from "./child-processes.js";
import type { PtyEntry } from "./types.js";
import { isViewerActive } from "./viewer-state.js";

const SHELL_TASK_POLL_MS = 1000;
export const SHELL_TASK_FINISHED_NOTIFY_MS = 10_000;

export interface ShellTaskWatchDeps {
  setWorking: (id: string, working: boolean, event?: string) => void;
  setWaiting: (id: string, waiting: boolean, event?: string) => void;
  now?: () => number;
}

interface ShellTaskWatch {
  timer: ReturnType<typeof setInterval>;
  running: boolean;
  startedAtMs: number | null;
}

const watches = new Map<string, ShellTaskWatch>();

function notifyShellTaskChange(sessionId: string, entry: PtyEntry, watch: ShellTaskWatch | undefined, running: boolean, deps: ShellTaskWatchDeps): void {
  const now = deps.now?.() ?? Date.now();
  if (running) {
    if (watch) watch.startedAtMs = now;
    deps.setWaiting(sessionId, false);
    deps.setWorking(sessionId, true, "UserPromptSubmit");
    return;
  }
  const durationMs = watch?.startedAtMs === null || watch?.startedAtMs === undefined ? 0 : now - watch.startedAtMs;
  const shouldNotify = durationMs >= SHELL_TASK_FINISHED_NOTIFY_MS && !isViewerActive(sessionId, entry);
  if (watch) watch.startedAtMs = null;
  if (shouldNotify) deps.setWaiting(sessionId, true, "Stop");
  deps.setWorking(sessionId, false, shouldNotify ? "Stop" : undefined);
}

export function stopShellTaskWatch(sessionId: string): void {
  const watch = watches.get(sessionId);
  if (!watch) return;
  clearInterval(watch.timer);
  watches.delete(sessionId);
}

export function pollShellTask(sessionId: string, entry: PtyEntry, deps: ShellTaskWatchDeps): boolean {
  const running = hasSessionChildProcess(sessionId, entry);
  const watch = watches.get(sessionId);
  const previous = watch?.running ?? false;
  if (watch) watch.running = running;
  if (running !== previous) {
    notifyShellTaskChange(sessionId, entry, watch, running, deps);
  }
  return running;
}

export function startShellTaskWatch(sessionId: string, entry: PtyEntry, deps: ShellTaskWatchDeps): void {
  if (entry.agent !== "shell") return;
  stopShellTaskWatch(sessionId);
  const timer = setInterval(() => pollShellTask(sessionId, entry, deps), SHELL_TASK_POLL_MS);
  timer.unref?.();
  watches.set(sessionId, { timer, running: false, startedAtMs: null });
  pollShellTask(sessionId, entry, deps);
}
