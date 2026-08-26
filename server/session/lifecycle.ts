// Transitional process/delete cleanup. Issue #174 moves each resource to its actual owner;
// viewer attach/detach/release deliberately lives outside this module.
import { lastPrompts, lastResponses, lastTitleAttemptMs, lastTitledUserTurns, titleInFlight } from "./registry.js";
import { forgetClearedTranscript } from "./cleared-transcripts.js";
import { cleanupSessionSettings } from "./session-settings.js";
import { cleanupSessionDrops } from "./session-drops.js";
import { runCompletionHook } from "./completion-hooks.js";
import { stopShellTaskWatch } from "./shell-task-watch.js";
import { messageOf } from "../errors.js";

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

export function createSessionLifecycle() {
  return {
    cleanupSessionResources,
  };
}
