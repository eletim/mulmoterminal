// Windows-only PATH resolution for the binaries we hand to node-pty.
//
// node-pty gates a spawn on its OWN lookup (src/win/path_util.cc get_shell_path), which
// compares each PATH directory's file name EXACTLY — it never appends an executable
// extension. A bare "claude" therefore misses `…\.local\bin\claude.exe` and the spawn dies
// with `File not found: ` (nothing after the colon, since the path it failed to find is the
// empty string). Handing it an absolute path skips that lookup entirely.
//
// The gate is all this has to satisfy: node-pty then launches via
// `CreateProcessW(nullptr, cmdline, …)`, which does its own PATH search. Which is also why
// only a PE image may be returned here — CreateProcess cannot run a `.cmd`, a `.bat`, or an
// extensionless shell shim, so resolving a bare name to one would turn a spawn that works
// today (the shim satisfies the gate, CreateProcess finds the real .exe elsewhere on PATH)
// into `Cannot create process`.
import { statSync } from "node:fs";
import path from "node:path";
import { pathFromEnv } from "./pty-env.js";

// `.exe` first: with both present, a bare name would have reached the `.exe` (CreateProcess
// appends exactly that), so resolving must not silently switch which file runs.
const EXECUTABLE_EXTENSIONS = [".exe", ".com"] as const;

const hasExecutableExtension = (bin: string): boolean => EXECUTABLE_EXTENSIONS.some((ext) => bin.toLowerCase().endsWith(ext));

// A name node-pty/CreateProcess already resolves on its own (absolute, or relative to a
// directory) rather than by searching PATH.
const namesAPath = (bin: string): boolean => bin.includes("\\") || bin.includes("/");

export function isExecutableFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** The absolute path of the executable a bare Windows command name refers to, or null when
 *  PATH holds no `.exe`/`.com` for it (the caller then leaves the name as it is). Pure —
 *  `searchPath` and the existence check are parameters, and `path.win32` + ";" are used
 *  explicitly, so the rule is checkable from a POSIX host too. */
export function resolveWindowsExecutable(bin: string, searchPath: string | undefined, fileExists: (candidate: string) => boolean): string | null {
  if (bin === "" || namesAPath(bin)) return null;
  const names = hasExecutableExtension(bin) ? [bin] : EXECUTABLE_EXTENSIONS.map((ext) => bin + ext);
  const candidates = searchDirectories(searchPath).flatMap((dir) => names.map((name) => path.win32.join(dir, name)));
  return candidates.find(fileExists) ?? null; // `find` is lazy: it stops at the first hit
}

// A PATH entry may be quoted — `"C:\Program Files\tools"` — which the shells strip and a
// plain join would not, leaving a path that matches nothing.
const searchDirectories = (searchPath: string | undefined): string[] =>
  (searchPath ?? "")
    .split(";")
    .map((entry) => entry.replace(/^"(.*)"$/, "$1"))
    .filter((entry) => entry !== "");

/** The name to hand node-pty for `bin`. Unchanged off Windows, and unchanged when nothing
 *  resolves — a host that spawns fine today must keep spawning fine. */
export function resolvePtyBin(bin: string, platform: NodeJS.Platform, searchPath: string | undefined, fileExists = isExecutableFile): string {
  if (platform !== "win32") return bin;
  return resolveWindowsExecutable(bin, searchPath, fileExists) ?? bin;
}

/** `resolvePtyBin` against the environment the session itself will run with: the binary that
 *  matters is the one reachable from the child's PATH, not the server's. */
export function resolvePtyBinForEnv(bin: string, env: NodeJS.ProcessEnv): string {
  return resolvePtyBin(bin, process.platform, pathFromEnv(env));
}
