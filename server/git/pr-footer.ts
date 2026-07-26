// The "which clone was this worked in" line appended to a PR body (#872). Several clones of
// the same repo run side by side (`mulmoclaude`, `mulmoclaude2`, …), and a PR on GitHub
// otherwise carries nothing that says which one produced it.
import path from "node:path";

/** The line for a repo root. `repoRoot()` returns the MAIN working tree even when called
 *  from a managed worktree, so this is the clone's name rather than the worktree's. */
export function workdirFooter(repoRootPath: string): string {
  return `work in ${path.basename(repoRootPath)}`;
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
