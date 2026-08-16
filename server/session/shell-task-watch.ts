import { hasSessionChildProcess } from "./child-processes.js";
import type { PtyEntry } from "./types.js";

const SHELL_TASK_POLL_MS = 1000;

export interface ShellTaskWatchDeps {
  setWorking: (id: string, working: boolean, event?: string) => void;
}

interface ShellTaskWatch {
  timer: ReturnType<typeof setInterval>;
  running: boolean;
}

const watches = new Map<string, ShellTaskWatch>();

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
  if (running !== previous) deps.setWorking(sessionId, running, running ? "UserPromptSubmit" : undefined);
  return running;
}

export function startShellTaskWatch(sessionId: string, entry: PtyEntry, deps: ShellTaskWatchDeps): void {
  if (entry.agent !== "shell") return;
  stopShellTaskWatch(sessionId);
  const timer = setInterval(() => pollShellTask(sessionId, entry, deps), SHELL_TASK_POLL_MS);
  timer.unref?.();
  watches.set(sessionId, { timer, running: false });
  pollShellTask(sessionId, entry, deps);
}
