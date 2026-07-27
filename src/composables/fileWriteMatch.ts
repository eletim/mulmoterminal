// Whether an agent's write landed on the file the editor has open.
//
// The server publishes the path as IT resolved it; the editor holds a project root plus a
// project-relative path. Comparing them means normalising separators (a Windows server sends
// backslashes) and ignoring case — macOS and Windows fold it, and being wrong in that direction
// only costs one extra version check, while being wrong the other way misses the notification
// this whole channel exists to deliver.
// Repeated separators collapse too, so a root that already ends in one still joins cleanly.
// Both sides go through this, so a UNC path stays comparable with itself.
const normalise = (p: string): string => p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase();

/** True when `written` is `openPath` under `cwd`. Null inputs mean nothing is open to match. */
export function isWriteToOpenFile(written: string, cwd: string | null, openPath: string | null): boolean {
  if (!cwd || !openPath) return false;
  return normalise(written) === normalise(`${cwd}/${openPath}`);
}
