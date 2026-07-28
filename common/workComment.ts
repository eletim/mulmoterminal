// The comments MulmoTerminal leaves on an issue: "a cell is on this" and "it was merged" (#979).
// Pure, and shared, because the marker is the whole idempotency story — the server writes it and
// the server reads it back, and a mismatch between the two would post the same comment on every
// poll of every tab.

export type WorkCommentKind = "start" | "merged";

// An HTML comment, so it is invisible in the rendered issue but survives a round-trip through the
// GitHub API. Keyed by kind AND directory: the same issue worked on from a second clone is a
// second, honest line in the thread, not a duplicate to suppress.
//
// The directory is percent-encoded, not interpolated raw: a folder may legally be called
// `foo-->bar`, and that string ends the HTML comment early — the rest spills into the rendered
// issue as text (Codex review). Encoding also keeps a newline or a backtick in a path from
// reshaping the comment. Ordinary names encode to themselves, so markers already posted still
// match.
export function workCommentMarker(kind: WorkCommentKind, dir: string): string {
  return `<!-- mulmoterminal:work:${kind} dir=${encodeURIComponent(dir)} -->`;
}

// The directory a comment names. The BASENAME only: the point is "which of my clones", and a full
// path on a public issue leaks the machine's layout (and, on a work machine, project names).
export function workCommentDirLabel(cwd: string): string {
  // Split-and-take-last rather than trimming a trailing separator with a regex: an anchored
  // `[/\\]+$` backtracks super-linearly, and a path is user input.
  const parts = cwd.split(/[/\\]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? cwd;
}

// `pr` is the number the merge came in as, when there is one — a reader of the issue should not
// have to go looking for which PR closed it.
export function workCommentBody(kind: WorkCommentKind, dir: string, pr: number | null): string {
  const marker = workCommentMarker(kind, dir);
  if (kind === "start") return `Working on this in \`${dir}\`.\n\n${marker}`;
  const where = pr === null ? "Merged." : `Merged in #${pr}.`;
  return `${where} Work done in \`${dir}\`.\n\n${marker}`;
}

// Has this exact comment already been left? Matching on the marker rather than the prose means an
// edited comment, or a change to the wording above, still counts as "already said".
export function alreadyCommented(bodies: readonly string[], kind: WorkCommentKind, dir: string): boolean {
  const marker = workCommentMarker(kind, dir);
  return bodies.some((body) => typeof body === "string" && body.includes(marker));
}
