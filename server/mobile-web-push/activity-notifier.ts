import type { SessionAgent } from "../../common/sessionAgent.js";
import { isPushKind, type PushKind } from "../../common/pushKinds.js";
import { activityNotifyStateOf, notifyKindOf, type ActivityNotifyState } from "../../common/activityNotifyKind.js";
import type { Activity } from "../session/types.js";

export interface MobileWebPushActivityNotification {
  kind: PushKind;
  sessionId: string;
  agent: SessionAgent | null;
}

export type MobileWebPushActivityState = Map<string, ActivityNotifyState>;

export function mobileWebPushKindForActivityTransition(
  state: MobileWebPushActivityState,
  sessionId: string,
  prev: Activity | undefined,
  next: Activity,
  event: string | undefined,
): PushKind | null {
  // The desktop sound player has usually seen the session's initial idle row ("created") before
  // a bare Stop arrives. The server activity map may still be empty because idle is represented
  // as no record, so seed that implicit baseline for Stop or the phone misses a sound the PC
  // plays. Other first observations remain baseline-only.
  if (!state.has(sessionId) && (prev || event === "Stop")) state.set(sessionId, activityNotifyStateOf(prev ?? {}));
  const kind = notifyKindOf(state, { id: sessionId, working: next.working ?? false, waiting: next.waiting ?? false, event: next.event ?? event ?? null });
  return isPushKind(kind) ? kind : null;
}

export function forgetMobileWebPushActivitySession(state: MobileWebPushActivityState, sessionId: string): void {
  state.delete(sessionId);
}
