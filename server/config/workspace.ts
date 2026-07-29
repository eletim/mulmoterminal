import { statSync } from "node:fs";
import path from "node:path";
import { CLAUDE_CWD } from "./env.js";
import { canonicalDir } from "../infra/path-within.js";

// Validate a client-supplied workspace dir: must be an absolute, existing
// directory. Anything else (relative, missing, a file) falls back to CLAUDE_CWD,
// so a cell can launch a terminal in a chosen dir without trusting raw input.
export function resolveWorkspace(cwd: string | null): string {
  return existingWorkspace(cwd) ?? CLAUDE_CWD;
}

// The same validation WITHOUT the fallback, for a route that REPORTS ON the directory it was
// asked about. Falling back there is a correctness bug rather than a safe default: the caller
// would render another directory's answer under the requested directory's name — and a stale
// preset (a project since deleted) is exactly when it happens.
// Canonical, not verbatim: this return value is the identity a directory is known by everywhere
// downstream — the PTY's cwd, the cwd echoed back to the cell, the key its dir-config
// subscription uses, and the path recorded as a launcher preset. `/a/b/` passes both guards
// below, so returning it unchanged made one directory into two names, and a `.mulmoterminal.json`
// change announced as `/a/b` never reached a cell that had launched as `/a/b/` (#1002).
// Canonicalize BEFORE the stat, so the directory that is checked is the one that is returned.
// The two disagree: `stat` resolves symlinks in the kernel, `path.resolve` is purely lexical, so
// `/x/link/../var` stats as `/var` (link -> /etc) while resolving to `/x/var`. Stat-then-resolve
// would hand back a path nothing had validated, and usually one that does not exist.
//
// Lexical and NOT realpath, deliberately: the announcing side of the dir-config channel spells
// the directory with `path.dirname`, which is lexical too, and canonicalizing only one side
// physically would re-open the very mismatch below.
export function existingWorkspace(cwd: string | null): string | null {
  if (!cwd || !path.isAbsolute(cwd)) return null;
  const dir = canonicalDir(cwd);
  try {
    return statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null; // not a dir / doesn't exist
  }
}

export function existingWorkspaceFromQuery(cwd: unknown): string | null {
  return existingWorkspace(typeof cwd === "string" ? cwd : null);
}

// Every `?cwd=` route resolves the same way: a string query param or the default
// workspace. Shared so a route can't accidentally skip the validation above.
export function workspaceFromQuery(cwd: unknown): string {
  return resolveWorkspace(typeof cwd === "string" ? cwd : null);
}
