// Legacy viewer teardown. Activity and notifications deliberately live elsewhere; the remaining
// fixed disconnect grace is removed with the viewer-lifecycle work in Issue #173.
import { lastPrompts, lastResponses, lastTitleAttemptMs, lastTitledUserTurns, ptys, titleInFlight } from "./registry.js";
import { forgetClearedTranscript } from "./cleared-transcripts.js";
import { reapTimerDelay } from "./reap-policy.js";
import { cleanupSessionSettings } from "./session-settings.js";
import { cleanupSessionDrops } from "./session-drops.js";
import { runCompletionHook } from "./completion-hooks.js";
import { stopShellTaskWatch } from "./shell-task-watch.js";
import { messageOf } from "../errors.js";

export interface SessionLifecycleDeps {
  /** Free the tmux window/client size bookkeeping. Unlike a socket close — which a reattach
   *  undoes — a reap means this id will never be nudged again (#957). */
  forgetTerminalSize: (id: string) => void;
}

// Timers live per process, not per factory call — there is one server.
const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();

// On disconnect we don't kill an idle session immediately — a page reload is a
// brief disconnect, and reaping then would throw away a perfectly good live
// terminal (and its scrollback). Instead we keep the pty for a grace window; a
// reattach within it cancels the reap, so a reload just re-attaches to the same
// running terminal. Only after the window with no reattach do we reap.
const REAP_GRACE_MS = 30_000;

function cancelReap(id: string) {
  const t = reapTimers.get(id);
  if (t) {
    clearTimeout(t);
    reapTimers.delete(id);
  }
}

function scheduleReap(deps: SessionLifecycleDeps, id: string, delayMs: number = REAP_GRACE_MS) {
  // null => never auto-reap; the session stays until reattached or explicitly
  // terminated (see reapTimerDelay for why a bad value must not reach setTimeout).
  const delay = reapTimerDelay(delayMs);
  if (delay === null) return;
  if (reapTimers.has(id)) return;
  reapTimers.set(
    id,
    setTimeout(() => {
      reapTimers.delete(id);
      const entry = ptys.get(id);
      if (entry && !entry.ws) reap(deps, id); // still detached after the grace window
    }, delay),
  );
}

// The remaining viewer grace is fixed. UI activity and shell-child observations cannot change it.
function armReapForDetached(deps: SessionLifecycleDeps, id: string) {
  const entry = ptys.get(id);
  if (!entry || entry.ws) return; // still attached: nothing to reap
  cancelReap(id);
  scheduleReap(deps, id);
}

function cleanupSessionResources(id: string) {
  stopShellTaskWatch(id);
  lastPrompts.delete(id);
  lastResponses.delete(id);
  forgetClearedTranscript(id);
  titleInFlight.delete(id);
  lastTitledUserTurns.delete(id);
  lastTitleAttemptMs.delete(id);
  cleanupSessionSettings(id);
  cleanupSessionDrops(id);
  void runCompletionHook(id, { didError: true }).catch((err) => console.error(`[completion-hook] ${messageOf(err)}`));
}

function reap(deps: SessionLifecycleDeps, id: string) {
  cancelReap(id);
  const entry = ptys.get(id);
  if (!entry) return; // already reaped
  ptys.delete(id);
  deps.forgetTerminalSize(id);
  try {
    entry.term.kill();
  } catch {
    // already gone
  }
  // This tears down only MulmoTerminal's transient tmux client. Core/tmux membership remains
  // until the explicit Core.delete() path runs, including for exited remain-on-exit panes.
}

function deleteSession(deps: SessionLifecycleDeps, id: string): void {
  cleanupSessionResources(id);
  reap(deps, id);
}

function cleanupManagedLiveSessions(deps: SessionLifecycleDeps): string[] {
  const ids = [...ptys.keys()];
  for (const id of ids) {
    try {
      reap(deps, id);
    } catch (err) {
      console.error(`[shutdown] failed to cleanup session ${id}: ${messageOf(err)}`);
    }
  }
  return ids;
}

export function createSessionLifecycle(deps: SessionLifecycleDeps) {
  return {
    cancelReap,
    scheduleReap: (id: string, delayMs?: number) => scheduleReap(deps, id, delayMs),
    armReapForDetached: (id: string) => armReapForDetached(deps, id),
    reap: (id: string) => reap(deps, id),
    cleanupSessionResources,
    deleteSession: (id: string) => deleteSession(deps, id),
    cleanupManagedLiveSessions: () => cleanupManagedLiveSessions(deps),
  };
}
