// Which notification a "sessions" activity row raises. Shared by the desktop sound player
// and local mobile Web Push so the two channels do not drift apart.

import type { NotifyKind } from "./notifyKinds.js";

export interface ActivityNotifyMsg {
  id: string;
  working?: boolean;
  waiting?: boolean;
  // The hook/event that caused this row ("Stop", "Notification", "closed", ...). Flags alone
  // cannot distinguish a finished background turn from an input wait.
  event?: string | null;
  cwd?: string | null;
  failed?: boolean;
}

export interface ActivityNotifyState {
  working: boolean;
  waiting: boolean;
  // The event whose rows we are currently reading, and whether it has already been announced.
  // One hook can publish more than one row; this collapses those rows back to one notification.
  event: string | null;
  announced: boolean;
}

export const isActivityNotifyMsg = (d: unknown): d is ActivityNotifyMsg => {
  if (typeof d !== "object" || d === null) return false;
  return (
    "id" in d &&
    typeof d.id === "string" &&
    (("working" in d && typeof d.working === "boolean") || ("waiting" in d && typeof d.waiting === "boolean") || "event" in d)
  );
};

function rawKind(was: ActivityNotifyState, now: ActivityNotifyState, event: string | null): NotifyKind | null {
  const attentionRose = !was.waiting && now.waiting;
  if (event === "Stop") return attentionRose || (was.working && !now.working) ? "finished" : null;
  if (was.working && !now.working) return "finished";
  return attentionRose ? "waiting" : null;
}

export function activityNotifyStateOf(msg: Pick<ActivityNotifyMsg, "working" | "waiting" | "event">): ActivityNotifyState {
  return { working: msg.working ?? false, waiting: msg.waiting ?? false, event: msg.event ?? null, announced: false };
}

/**
 * The notification this activity row raises, or null for none. First sight of a session is
 * baseline only. Mutates `prev` to the latest state.
 */
export function notifyKindOf(prev: Map<string, ActivityNotifyState>, msg: ActivityNotifyMsg): NotifyKind | null {
  if (msg.event === "closed" || msg.event === "exited") {
    const seen = prev.delete(msg.id);
    if (msg.failed) return "worker-failed";
    return seen ? "session-exited" : null;
  }
  const event = msg.event ?? null;
  const was = prev.get(msg.id);
  const announced = was?.event === event && (was?.announced ?? false);
  const now: ActivityNotifyState = { working: msg.working ?? false, waiting: msg.waiting ?? false, event, announced };
  prev.set(msg.id, now);
  if (!was) return null;
  const kind = announced ? null : rawKind(was, now, event);
  if (kind) now.announced = true;
  else if (announced && !now.waiting) now.announced = false;
  return kind;
}
