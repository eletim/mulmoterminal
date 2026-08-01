// What a worktree row does when it is clicked.
//
// A worktree is one branch, so it holds one session: a second agent started in it is not
// isolation, it is two agents editing the same working tree. That makes the row three-valued
// rather than "launch here", and the third value is the one this exists for — a session somebody
// is holding must not be handed to another cell, which is how a running agent's terminal got
// taken over (#1207).

import type { SessionOccupancy } from "../../common/sessionOccupancy";

export type WorktreeAction = "start" | "resume" | "busy";

/** `undefined` — a server that predates the field — reads as "no session", i.e. what every
 *  worktree row did before: start a fresh one. */
export function worktreeAction(session: SessionOccupancy | null | undefined): WorktreeAction {
  if (!session) return "start";
  return session.attached ? "busy" : "resume";
}
