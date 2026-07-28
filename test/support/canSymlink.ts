import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Whether this machine can create a symlink at all. On Windows it needs Developer Mode or an
// elevated shell, so a spec that builds a symlink fixture there asserts against a link that was
// never made — which reads as the behaviour being broken rather than untestable.
//
// Probed rather than checked against `process.platform`: a Windows runner WITH Developer Mode
// should run these, and a platform check would skip them anyway.
export const canSymlink = (() => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-symlink-probe-"));
  try {
    symlinkSync(dir, path.join(dir, "link"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();
