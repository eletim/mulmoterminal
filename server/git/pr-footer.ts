// The "which clone was this worked in" line appended to a PR body (#872). Several clones of
// the same repo run side by side (`mulmoclaude`, `mulmoclaude2`, …), and a PR on GitHub
// otherwise carries nothing that says which one produced it.
import path from "node:path";

// A clone name is a DIRECTORY name, and on POSIX that may contain newlines, tabs and control
// characters. The line goes into a PR body and — since #973 — into a session's system prompt, so
// a name carrying a line break could append instructions of its own there. Sanitised at the
// source, where the untrusted value enters, rather than at each place it is used.
const MAX_CLONE_NAME_CHARS = 64;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;

function cloneName(repoRootPath: string): string {
  return path.basename(repoRootPath).replace(CONTROL_OR_FORMAT, " ").replace(/\s+/g, " ").trim().slice(0, MAX_CLONE_NAME_CHARS).trim();
}

/** The line for a repo root, or null when the directory name has nothing usable left in it.
 *  `repoRoot()` returns the MAIN working tree even when called from a managed worktree, so this
 *  is the clone's name rather than the worktree's. */
export function workdirFooter(repoRootPath: string): string | null {
  const name = cloneName(repoRootPath);
  return name ? `work in ${name}` : null;
}

/** `body` with the footer as its last line. Idempotent — re-running the PR button on a
 *  branch that already carries the line must not stack a second copy. */
export function withFooter(body: string, footer: string): string {
  const trimmed = body.trimEnd();
  // Per line, and tolerant of a trailing `\r`: a body round-tripped through GitHub can come
  // back CRLF, and a footer that failed to match there would be appended a second time.
  if (trimmed.split("\n").some((line) => line.trimEnd() === footer)) return body;
  return trimmed === "" ? footer : `${trimmed}\n\n${footer}`;
}
