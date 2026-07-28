// Whether a command could be launched at all, without launching it.
//
// Pulled out of whisper.ts (#1011) because a second caller needed the same question and the two
// must not drift: the rate-limit probe asks it BEFORE spawning, so that a machine with no `claude`
// costs a PATH lookup instead of a spawn attempt per poll.
//
// Windows is why this is not a one-line existsSync: `claude` installed by npm is `claude.cmd`, and
// a bare name never matches a file on disk there. resolve-bin.ts already owns that rule for the
// spawn path, and reusing it keeps "can we launch it" and "what do we launch" answering the same
// way — a check that said yes where the spawn then said no would be worse than no check.

import { existsSync } from "node:fs";
import path from "node:path";
import { isExecutableFile, resolveWindowsBatch, resolveWindowsExecutable } from "./resolve-bin.js";

/** `bin` may be a bare command name or a path. A path is checked as given; a name is looked up on
 *  PATH, including the Windows `.exe` / `.cmd` forms. */
export function hasBinary(bin: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (!bin) return false;
  if (bin.includes("/") || bin.includes("\\")) return existsSync(bin);
  const searchPath = env.PATH ?? env.Path;
  if (platform === "win32") {
    return resolveWindowsExecutable(bin, searchPath, isExecutableFile) !== null || resolveWindowsBatch(bin, searchPath, isExecutableFile) !== null;
  }
  const dirs = (searchPath ?? "").split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => existsSync(path.join(dir, bin)));
}
