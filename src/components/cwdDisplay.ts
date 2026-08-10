// Format an absolute working directory for the compact cell header: anchor on the
// home dir (~), and if it's still too long keep the TAIL (the most specific part)
// and drop the front behind an ellipsis — e.g. "…hoge/foo/bar".
import { homeRelative, truncateFront } from "../../common/pathDisplay";

export { homeRelative, truncateFront } from "../../common/pathDisplay";

export function formatCwd(cwd: string | null, home: string | null, max = 30): string {
  if (!cwd) return "";
  return truncateFront(homeRelative(cwd, home), max);
}

// A managed worktree's cwd looks like .../worktrees/<repo>-<8hex>/<task> (see the
// server's worktreesRoot). For those, the long managed path is noise in the header
// — surface "<repo> (<task>)" instead. Returns null for any non-worktree path.
const MANAGED_DIR = /^(.+)-[0-9a-f]{8}$/;
export function worktreeLabel(cwd: string | null): { repo: string; task: string } | null {
  if (!cwd) return null;
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  const i = parts.indexOf("worktrees");
  const dir = parts[i + 1];
  const task = parts[i + 2];
  if (i < 0 || !dir || !task) return null;
  const m = MANAGED_DIR.exec(dir);
  return m?.[1] === undefined ? null : { repo: m[1], task };
}
