// The cwd-relative path a clicked terminal token names, or null when it is not under that
// cwd at all. The Files pane is rooted at its cell's directory and cannot walk above it, so
// this is what decides whether a click can go there or has to keep its old route.
//
// Browser-side, so no `node:path`. A token only becomes a link if it contains `/` and is not
// preceded by `:` (see terminalFilePathLinks), which means a `C:\...` path never reaches here
// — but the CWD still arrives with backslashes on Windows, so separators are normalized
// before anything is compared.

const DRIVE_PREFIX = /^[A-Za-z]:/;

const toSlashes = (p: string): string => p.replace(/\\/g, "/");

// Case-folded only when the root looks like a Windows path. On a case-sensitive filesystem
// `/A/b` and `/a/b` are two directories, and folding would silently accept the wrong one.
const isWindowsRoot = (root: string): boolean => DRIVE_PREFIX.test(root);

const isAbsolute = (p: string): boolean => p.startsWith("/") || DRIVE_PREFIX.test(p);

/** `rel` with `.` dropped and `..` applied, or null when it climbs above the root. Empty
 *  (the root itself, or a path that cancels out) is null too — there is no file to open. */
function resolveSegments(rel: string): string | null {
  const out: string[] = [];
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.pop() === undefined) return null; // climbed past the root
      continue;
    }
    out.push(segment);
  }
  return out.length ? out.join("/") : null;
}

/** `path` with `root` removed, or null when it names something outside. Compared segment by
 *  segment: a plain `startsWith` would let root `/a/b` swallow `/a/bc/d.ts`. */
function stripRoot(path: string, root: string): string | null {
  const fold = (p: string): string => (isWindowsRoot(root) ? p.toLowerCase() : p);
  const rootSegments = fold(root).split("/").filter(Boolean);
  const pathSegments = fold(path).split("/").filter(Boolean);
  if (pathSegments.length < rootSegments.length) return null;
  if (rootSegments.some((segment, i) => segment !== pathSegments[i])) return null;
  // Slice the ORIGINAL, not the folded copy — the server gets the path the user's disk uses.
  return path.split("/").filter(Boolean).slice(rootSegments.length).join("/");
}

/** Where `token` sits inside `cwd`, as a `/`-separated relative path — or null when it is
 *  outside, names the directory itself, or `cwd` is unknown. */
export function pathWithinCwd(token: string, cwd: string | null): string | null {
  if (!cwd) return null;
  const path = toSlashes(token);
  const root = toSlashes(cwd);
  const relative = isAbsolute(path) ? stripRoot(path, root) : path;
  return relative === null ? null : resolveSegments(relative);
}
