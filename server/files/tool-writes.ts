// Which file a Claude tool call just wrote. The hooks already report every tool call, so they
// double as a change feed — no filesystem watchers, which this app cannot share anyway (each
// terminal's cwd is somewhere else) and which on Windows can abort the process outright.
import path from "node:path";
import { isRecord } from "../../common/isRecord.js";

const WRITE_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit"]);

/** The absolute path a write tool just wrote, or null for anything else.
 *
 *  A relative `file_path` is relative to the SESSION's cwd, never the server process's —
 *  resolving it against `process.cwd()` would name a file nobody is looking at AND miss the
 *  real one, so without a known session cwd there is nothing to report. */
export function writtenFilePath(toolName: unknown, toolInput: unknown, sessionCwd: string | null = null): string | null {
  if (typeof toolName !== "string" || !WRITE_TOOLS.has(toolName)) return null;
  if (!isRecord(toolInput) || typeof toolInput.file_path !== "string") return null;
  const file = toolInput.file_path;
  if (path.isAbsolute(file)) return path.resolve(file);
  return sessionCwd ? path.resolve(sessionCwd, file) : null;
}
