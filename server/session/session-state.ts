import { activity, lastPrompts, lastResponses } from "./activity-store.js";
import { clearedTranscripts } from "./cleared-transcripts.js";
import type { CoreSession } from "./core-session-adapter.js";
import { sessionMemos, sessionMemosHydrated } from "./history-memos.js";
import { readSessionSummary } from "./session-reads.js";
import { sessionDetailView } from "./session-detail-view.js";
import type { WorkPhase } from "./workPhase.js";

export interface SessionStateReaderDeps {
  getCoreSession: (sessionId: string) => Promise<CoreSession | null>;
  workPhaseOf?: (sessionId: string) => WorkPhase | null;
}

/**
 * One authoritative display snapshot assembled from the same Core metadata, activity maps and
 * transcript-derived values as GET /api/session/:id. It owns no state and performs no polling;
 * callers invoke it only for an initial WebSocket snapshot or a compatibility HTTP read.
 */
export async function readSessionState(sessionId: string, cwd: string, deps: SessionStateReaderDeps) {
  const [{ lastPrompt: transcriptPrompt, lastResponse: transcriptResponse, userTurns, usage, context, workPhase }, core] = await Promise.all([
    readSessionSummary(cwd, sessionId),
    deps.getCoreSession(sessionId),
  ]);
  if (!core) await sessionMemosHydrated;
  const view = sessionDetailView(
    {
      lastPrompt: lastPrompts.get(sessionId),
      lastResponse: lastResponses.get(sessionId),
      aiTitle: core?.title,
      memo: core ? core.memo : sessionMemos.get(sessionId),
    },
    { lastPrompt: transcriptPrompt, lastResponse: transcriptResponse },
    core?.exited ? {} : (activity.get(sessionId) ?? {}),
    clearedTranscripts.has(sessionId),
  );
  const liveWorkPhase = deps.workPhaseOf?.(sessionId);
  return {
    state: {
      id: sessionId,
      cwd,
      ...view,
      usage,
      context,
      workPhase: core?.exited ? null : (liveWorkPhase ?? workPhase),
      exited: core?.exited ?? false,
    },
    userTurns,
  };
}
