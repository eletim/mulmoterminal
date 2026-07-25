// Where a session's working dir points on GitHub. Pure (no I/O) so the rule is exhaustively
// unit-tested; the caller supplies the repository URL, branch and whether that branch is on
// the same remote the URL came from.

// A branch earns /tree/<branch> only once it is on origin. A managed worktree starts on a
// fresh `agent/<slug>` that exists nowhere but this machine, and a branch tracking a second
// remote is missing from origin just the same — linking to either would 404. The repository
// root always resolves.
export function githubBranchUrl(repoUrl: string | null, branch: string | null, branchIsOnOrigin: boolean): string | null {
  if (!repoUrl) return null;
  if (!branch || !branchIsOnOrigin) return repoUrl;
  return `${repoUrl}/tree/${encodeBranchPath(branch)}`;
}

// Slashes in a branch name are path separators on GitHub (`agent/foo` → `/tree/agent/foo`),
// so they must survive encoding; everything else is escaped per segment.
const encodeBranchPath = (branch: string): string => branch.split("/").map(encodeURIComponent).join("/");
