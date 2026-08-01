// A directory path reduced to a form two spellings of the same directory share, for comparing a
// path the USER typed against one a tool reported.
//
// Lexical only — no filesystem, because the browser has none. It therefore cannot see through a
// symlink, and is not what any invariant may rest on: the server decides that with a realpath
// containment check (git/worktrees.ts). This exists so a control is greyed out BEFORE the click
// for the spellings a person actually types — a trailing slash, a `.`, a `..` (#1207).
//
// Both separators are folded, since the same app runs on Windows and the field takes either.

const SEPARATORS = /[/\\]+/;

/** Windows drive/UNC prefixes and the POSIX root, which the segment walk below must not eat. */
const rootOf = (path: string): string => {
  const drive = /^[a-zA-Z]:[/\\]?/.exec(path);
  if (drive) return drive[0].replace(/[/\\]$/, "") + "/";
  return SEPARATORS.test(path.charAt(0)) ? "/" : "";
};

export function dirPathKey(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "") return "";
  const root = rootOf(trimmed);
  const walked: string[] = [];
  for (const segment of trimmed.slice(root.length).split(SEPARATORS)) {
    if (segment === "" || segment === ".") continue;
    // A `..` above a rooted path has nowhere to go, and dropping the root would turn an absolute
    // path into a relative one that could then match something else.
    if (segment === ".." && walked.length > 0 && walked[walked.length - 1] !== "..") walked.pop();
    else if (segment !== ".." || root === "") walked.push(segment);
  }
  return root + walked.join("/");
}

/** Whether two paths name the same directory, as far as spelling can tell. */
export const isSameDirPath = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && dirPathKey(a) === dirPathKey(b);
