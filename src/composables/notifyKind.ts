// Which notification a "sessions" activity push raises. Pure and separate from the player so
// the mapping is unit-testable without an AudioContext.

import type { NotifyKind } from "../../common/notifyKinds";

export interface ActivityMsg {
  id: string;
  working?: boolean;
  waiting?: boolean;
  // The hook that caused this push ("Stop", "Notification", "closed", a tool event…). Which
  // one it was is NOT recoverable from the flags: a background Stop raises the very same
  // `waiting` flag a permission prompt does (see server/session/activity-hook.ts), so
  // without this a finished turn and a blocked one are indistinguishable here.
  event?: string | null;
  // The session's working dir, so a beep can use that directory's own sound.
  cwd?: string | null;
}

export interface ActivityState {
  working: boolean;
  waiting: boolean;
}

export const isActivityMsg = (d: unknown): d is ActivityMsg => typeof d === "object" && d !== null && "id" in d;

/**
 * The notification this push raises, or null for none. First sight of a session is baseline
 * only. Mutates `prev` to the latest state.
 *
 * A background Stop publishes TWICE — `waiting: true` then `working: false`, both labelled
 * "Stop" — so the waiting arm ignores a Stop-labelled push and the finished arm answers the
 * second one. Reading the flags alone (as this did before #873) counted both, which is one
 * of the ways eight parallel sessions turned into a storm of beeps.
 */
export function notifyKindOf(prev: Map<string, ActivityState>, msg: ActivityMsg): NotifyKind | null {
  // The PTY was reaped: forget the session, so an id that comes back is a baseline again and
  // not compared against a state from its previous life.
  if (msg.event === "closed") return prev.delete(msg.id) ? "session-exited" : null;
  const now: ActivityState = { working: msg.working ?? false, waiting: msg.waiting ?? false };
  const was = prev.get(msg.id);
  prev.set(msg.id, now);
  if (!was) return null;
  if (was.working && !now.working) return "finished";
  if (!was.waiting && now.waiting && msg.event !== "Stop") return "waiting";
  return null;
}
