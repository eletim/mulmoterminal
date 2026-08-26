// Tail a live codex session's rollout and report each turn boundary it appends.
//
// Polling, not fs.watch: the rollout lives under the user's profile, and on Windows a
// watch opened on an 8.3 short path makes libuv abort() the whole process — uncatchable
// by try/catch, on("error"), or uncaughtException. codex flushes each record immediately
// (measured at 0.5 ms), so a one-second poll costs a negligible amount of detection lag
// and none of that risk.
//
// Every dependency is injected so the loop can be driven with fakes: the real one reads
// the filesystem and mutates session flags, neither of which a test should need.

import { codexUserPrompts, nextReadRange, takeCompleteLines, turnBoundaries, type CodexTurnBoundary } from "../agents/codex-activity.js";

export const CODEX_ACTIVITY_POLL_MS = 1000;

export interface CodexActivityDeps {
  /** Byte length of the rollout, or null while it doesn't exist yet. */
  fileSize: () => Promise<number | null>;
  /** The rollout's bytes in [from, to). */
  readSlice: (from: number, to: number) => Promise<string>;
  onBoundary: (boundary: CodexTurnBoundary) => void;
  onPrompt?: (prompt: string) => void;
  onResumeBaseline?: () => Promise<void>;
  /** False once the owning Core session is no longer live — the loop stops on the next tick. */
  isAlive: () => boolean | Promise<boolean>;
  /** Resume only: skip what the rollout already holds. A fresh session starts at 0 so its
   *  first turn isn't missed; a resumed one would otherwise REPLAY every past turn and
   *  leave the cell flagged from history rather than from what is happening now. */
  startAtEnd: boolean;
  sleep: (ms: number) => Promise<void>;
}

export async function watchCodexActivity(deps: CodexActivityDeps): Promise<void> {
  let offset = deps.startAtEnd ? await startingOffset(deps) : 0;
  if (deps.startAtEnd && offset > 0) await deps.onResumeBaseline?.();
  let pending = "";
  while (await deps.isAlive()) {
    await deps.sleep(CODEX_ACTIVITY_POLL_MS);
    if (!(await deps.isAlive())) return;
    const size = await deps.fileSize();
    if (size === null) continue; // rollout not written yet (codex creates it on the first turn)
    const range = nextReadRange(offset, size);
    if (!range) continue;
    if (range.from === 0 && offset > 0) pending = ""; // the file restarted — the fragment is stale
    const taken = takeCompleteLines(pending, await deps.readSlice(range.from, range.to));
    pending = taken.pending;
    offset = range.to;
    for (const line of taken.lines) {
      codexUserPrompts([line]).forEach((prompt) => deps.onPrompt?.(prompt));
      turnBoundaries([line]).forEach(deps.onBoundary);
    }
  }
}

// A rollout that doesn't exist yet has no history to skip, so a resume that beat codex to
// the file still starts from 0 and sees its first turn.
const startingOffset = async (deps: CodexActivityDeps): Promise<number> => (await deps.fileSize()) ?? 0;
