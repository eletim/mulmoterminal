import type { SessionAgent } from "../../common/sessionAgent.js";
import type { PushKind } from "../../common/pushKinds.js";
import type { Activity } from "../session/types.js";
import type { ActivityFlag } from "../session/activity-flag.js";

export interface MobileWebPushActivityNotification {
  kind: PushKind;
  sessionId: string;
  agent: SessionAgent | null;
}

export function mobileWebPushKindForActivityTransition(
  prev: Activity | undefined,
  next: Activity,
  flag: ActivityFlag,
  value: boolean,
  event: string | undefined,
): PushKind | null {
  if (prev?.working !== true) return null;
  if (flag === "waiting" && value && event === "Notification" && next.waiting === true) return "waiting";
  if (flag === "working" && !value && event === "Stop" && next.working === false) return "finished";
  return null;
}
