// The one existing Core terminal that occupies a directory.
//
// Conversation files are intentionally absent from this module. They are resume sources owned by
// each agent, not evidence that a terminal exists. A worktree is occupied only while Core lists a
// matching terminal session; deleting that Core member makes the worktree free.

import { canonicalPath } from "../git/worktrees.js";
import { isSessionAttached, type SessionOccupancy } from "../../common/sessionOccupancy.js";
import { isTerminalAgent, type TerminalAgent } from "../../common/sessionAgent.js";
import { viewerPtys } from "./registry.js";
import type { CoreSession } from "./core-session-adapter.js";

export interface DirSession extends SessionOccupancy {
  id: string;
  agent: TerminalAgent;
}

export interface DirSessionCandidate extends DirSession {
  createdAt: number;
}

const beats = (candidate: DirSessionCandidate, best: DirSessionCandidate): boolean =>
  (candidate.attached ? 1 : 0) > (best.attached ? 1 : 0) || (candidate.attached === best.attached && candidate.createdAt > best.createdAt);

export function pickDirSession(candidates: readonly DirSessionCandidate[]): DirSession | null {
  const best = candidates.reduce<DirSessionCandidate | null>((won, candidate) => (won === null || beats(candidate, won) ? candidate : won), null);
  return best === null ? null : { id: best.id, attached: best.attached, agent: best.agent };
}

/** Viewer/peer occupancy for an id already proven to be a Core member. The process-local tmux
 * client is transport, not a viewer, and is subtracted from the shared client count. */
export function sessionAttached(id: string, tmuxCounts: Map<string, number> | null): boolean {
  const entry = viewerPtys.get(id);
  return isSessionAttached({
    viewedHere: !!entry?.ws && entry.ws.readyState === entry.ws.OPEN,
    tmuxClients: tmuxCounts === null ? null : (tmuxCounts.get(id) ?? 0),
    holdsTmuxClient: !!entry?.tmux,
  });
}

/** Pick only from the canonical Core membership snapshot supplied by the caller. */
export function dirSession(dir: string, sessions: readonly CoreSession[], tmuxCounts: Map<string, number> | null): DirSession | null {
  const target = canonicalPath(dir);
  const candidates = sessions.flatMap<DirSessionCandidate>((session) => {
    if (session.visibility !== "normal" || !isTerminalAgent(session.agent) || canonicalPath(session.cwd) !== target) return [];
    return [{ id: session.id, agent: session.agent, attached: sessionAttached(session.id, tmuxCounts), createdAt: session.createdAt.getTime() }];
  });
  return pickDirSession(candidates);
}
