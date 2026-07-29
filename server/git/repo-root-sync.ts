// The main checkout for a directory, resolved from the filesystem instead of by spawning git.
//
// `repoRoot()` in worktrees.ts is the async answer and stays the one to use. This exists for
// the session spawn path, which is synchronous by contract (it returns a PtyEntry) and already
// does its per-spawn reads this way (loadDirConfig). Spawning git synchronously there would
// block the whole server for the duration; walking up the tree costs a few `existsSync` calls.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const GITDIR_PREFIX = "gitdir:";

/** The MAIN working tree containing `dir`, or null when it is not in a repo at all. Called
 *  from inside a linked worktree it answers with the main checkout, not the worktree — which
 *  is what names a clone, since the branch is already on the PR. */
export function repoRootSync(dir: string): string | null {
  let current = path.resolve(dir);
  for (;;) {
    const dotGit = path.join(current, ".git");
    if (existsSync(dotGit)) return isDirectory(dotGit) ? current : mainCheckoutFromGitFile(dotGit);
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

// A linked worktree's `.git` is a FILE holding `gitdir: <main>/.git/worktrees/<name>`, so the
// main checkout is two segments above the `worktrees` one. A submodule's `.git` is a file too
// and has no `worktrees` segment — there the gitdir itself is the answer's `.git`.
function mainCheckoutFromGitFile(file: string): string | null {
  const line = readText(file);
  if (!line?.startsWith(GITDIR_PREFIX)) return null;
  // Split on BOTH separators: the file is written with forward slashes even on Windows.
  const parts = line.slice(GITDIR_PREFIX.length).trim().split(/[/\\]/);
  const worktrees = parts.lastIndexOf("worktrees");
  const gitDirParts = worktrees > 0 ? parts.slice(0, worktrees) : parts;
  if (gitDirParts[gitDirParts.length - 1] !== ".git") return null;
  const root = gitDirParts.slice(0, -1).join(path.sep);
  return root || null;
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}
