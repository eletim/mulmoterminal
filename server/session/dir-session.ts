// The one existing Core terminal that occupies a directory.
//
// Conversation files are intentionally absent from this module. They are resume sources owned by
// each agent, not evidence that a terminal exists. A worktree is occupied only while Core lists a
// matching terminal session; deleting that Core member makes the worktree free.

import { canonicalPath } from "../git/worktrees.js";
import type { SessionOccupancy } from "../../common/sessionOccupancy.js";
import { isTerminalAgent, type TerminalAgent } from "../../common/sessionAgent.js";
import { isProbeSessionId } from "../agents/probe-session.js";
import { isBackgroundSession, translationWorkerIds } from "./registry.js";
import type { CoreSession } from "./core-session-adapter.js";

export interface DirSession extends SessionOccupancy {
  id: string;
  agent: TerminalAgent;
}

export interface DirSessionCandidate extends DirSession {
  createdAt: number;
}

const isUserSession = (id: string): boolean => !isProbeSessionId(id) && !translationWorkerIds.has(id) && !isBackgroundSession(id);

const beats = (candidate: DirSessionCandidate, best: DirSessionCandidate): boolean =>
  (candidate.attached ? 1 : 0) > (best.attached ? 1 : 0) || (candidate.attached === best.attached && candidate.createdAt > best.createdAt);

export function pickDirSession(candidates: readonly DirSessionCandidate[]): DirSession | null {
  const best = candidates.reduce<DirSessionCandidate | null>((won, candidate) => (won === null || beats(candidate, won) ? candidate : won), null);
  return best === null ? null : { id: best.id, attached: best.attached, agent: best.agent };
}

/** Pick only from the canonical Core membership snapshot supplied by the caller. */
export function dirSession(dir: string, sessions: readonly CoreSession[]): DirSession | null {
  const target = canonicalPath(dir);
  const candidates = sessions.flatMap<DirSessionCandidate>((session) => {
    if (!isUserSession(session.id) || !isTerminalAgent(session.agent) || canonicalPath(session.cwd) !== target) return [];
    return [{ id: session.id, agent: session.agent, attached: session.attached, createdAt: session.createdAt.getTime() }];
  });
  return pickDirSession(candidates);
}
