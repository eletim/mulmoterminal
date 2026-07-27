import { statSync } from "node:fs";
import path from "node:path";
import { CLAUDE_CWD } from "./env.js";

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
export function existingWorkspace(cwd: string | null): string | null {
  if (!cwd || !path.isAbsolute(cwd)) return null;
  try {
    return statSync(cwd).isDirectory() ? cwd : null;
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
