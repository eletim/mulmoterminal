// What GET /api/git-status answers with — the wire shape shared across the build
// boundary so the server's reader and the client's poller can't drift.
export interface GitStatus {
  repo: boolean;
  branch: string | null; // null when detached or non-repo
  detached: boolean;
  dirty: number; // uncommitted entries (incl. untracked)
  ahead: number; // commits on HEAD not on the upstream
  behind: number; // commits on the upstream not on HEAD
  upstream: boolean; // HEAD has a tracking branch (ahead/behind are meaningful)
}
