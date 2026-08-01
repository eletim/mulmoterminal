// The one-session-per-worktree rule, enforced where a session is actually created.
//
// The launcher greys the row out, but that is the explanation, not the guarantee: a directory can
// be spelled several ways (`/wt/x/`, `/repo/../wt/x`, a symlinked root), a chip can point into a
// repo whose worktree list the form never fetched, and the phone and the remote-host bridge open
// terminals without the form at all. Codex raised the first of those on #1208; all of them are the
// same hole, and this is the choke point that closes it for every client at once.
//
// Only a MANAGED worktree is limited. An ordinary directory takes as many terminals as the user
// wants — that is what the grid is for.

import { isManagedWorktree, repoRoot } from "../git/worktrees.js";
import { tmuxAttachedCounts } from "../infra/tmux.js";
import { dirSession, type DirSession } from "./dir-session.js";

/**
 * The session that already occupies `cwd`, when `cwd` is a managed worktree — so starting a fresh
 * session there would be its second. Null when the directory is not a worktree, is one with no
 * session, or cannot be resolved at all: git failing is not a reason to refuse someone a terminal.
 *
 * `isManagedWorktree` canonicalizes both sides through realpath, which is also what path aliases
 * cannot slip past.
 */
export async function occupiedWorktreeSession(cwd: string): Promise<DirSession | null> {
  const repo = await repoRoot(cwd).catch(() => null);
  if (!repo || !isManagedWorktree(repo, cwd)) return null;
  return dirSession(cwd, tmuxAttachedCounts(), Date.now());
}
