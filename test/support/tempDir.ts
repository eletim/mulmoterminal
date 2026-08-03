import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Every directory handed out, so `test/setup-temp-dirs.ts` can remove them when the file that
// asked for them is done. Tracking lives here rather than at the call sites because a helper that
// only creates makes every caller leak by construction — 20 spec files did, and the next one
// written would have joined them (the same reasoning as `test/setup-auto-unmount.ts`).
const handedOut: string[] = [];

// A temp directory spelled the way the production code will resolve it.
//
// Two platforms rewrite the path `mkdtemp` hands back, and a fixture that skips this compares a
// path the code under test never produces:
//
//   macOS   /var/... -> /private/var/...        (the temp dir is itself behind a symlink)
//   Windows C:\Users\RUNNER~1\... -> ...\runneradmin\...   (an 8.3 short component)
//
// `.native` matters on Windows: Node's JS realpathSync leaves the 8.3 component alone while the
// native call expands it, so only the native one agrees with what the server resolves
// (server/git/worktrees.ts says the same, and #1052 is the CI failure that proved it).
export function makeTempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
  handedOut.push(dir);
  return dir;
}

/** The same, for a spec that creates its directory with the promises API. Resolving stays sync —
 *  `fs/promises` has no `.native`, and this is one stat on a directory just created. */
export async function makeTempDirAsync(prefix: string): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const dir = realpathSync.native(await mkdtemp(path.join(tmpdir(), prefix)));
  handedOut.push(dir);
  return dir;
}

/** Remove every directory handed out so far and forget them. Registered once per test file by
 *  `test/setup-temp-dirs.ts`; nothing else should call it.
 *
 *  A removal that fails is swallowed on purpose. A spec that already deleted its own directory, and
 *  a Windows handle still open on one, are both fine — turning a passing run red during cleanup
 *  would trade a disk-space problem for a flaky suite. */
export function removeTrackedTempDirs(): void {
  for (const dir of handedOut.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Already gone, or held by another process. Neither is this suite's problem.
    }
  }
}

/** How many directories are waiting to be removed. Exists so a spec can prove the registry is
 *  actually wired to the caller — see `test/support/tempDir.spec.ts`. */
export const trackedTempDirCount = (): number => handedOut.length;
