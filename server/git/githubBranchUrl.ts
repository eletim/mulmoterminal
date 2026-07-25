// Where a session's working dir points on GitHub. Pure (no I/O) so the rule is exhaustively
// unit-tested; the caller supplies the repository URL, branch and upstream flag.

// A branch earns /tree/<branch> only once it has an upstream. A managed worktree starts on a
// fresh `agent/<slug>` that exists nowhere but this machine, so linking to it would 404 —
// and so would any branch the user hasn't pushed yet. The repository root always resolves.
export function githubBranchUrl(repoUrl: string | null, branch: string | null, hasUpstream: boolean): string | null {
  if (!repoUrl) return null;
  if (!branch || !hasUpstream) return repoUrl;
  return `${repoUrl}/tree/${encodeBranchPath(branch)}`;
}

// Slashes in a branch name are path separators on GitHub (`agent/foo` → `/tree/agent/foo`),
// so they must survive encoding; everything else is escaped per segment.
const encodeBranchPath = (branch: string): string => branch.split("/").map(encodeURIComponent).join("/");
