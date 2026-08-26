import { isProbeSessionId } from "../agents/probe-session.js";
import { backgroundSessionsHydrated, isBackgroundSession, translationWorkerIds } from "./registry.js";
import type { CoreSession } from "./core-session-adapter.js";

/**
 * Terminal membership comes exclusively from Core. This is the narrower UI policy shared by
 * Desktop and Mobile: disposable probes and background helpers remain Core sessions, but are not
 * user terminal rows. Placement is deliberately absent because it is browser-local layout state.
 */
export async function visibleCoreSessions(sessions: readonly CoreSession[]): Promise<CoreSession[]> {
  await backgroundSessionsHydrated;
  return sessions.filter((session) => !translationWorkerIds.has(session.id) && !isProbeSessionId(session.id) && !isBackgroundSession(session.id));
}
