// Finding the newest Codex rollout on disk and reading its tail. The parsing lives next door in
// codex-rate-limits.ts; this half is the filesystem, kept apart so the rules stay testable without
// one.
//
// Only the TAIL is read. A long Codex session's rollout runs to megabytes, the windows are written
// on nearly every event, and the one that matters is the last — so reading the whole file to reach
// its end would be the most expensive way to get the cheapest data source we have.
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Enough to hold several events even when one carries a large payload. A rollout whose last
// rate_limits sits further back than this simply reports nothing, which the gauge already handles.
const TAIL_BYTES = 256 * 1024;

export const codexSessionsDir = (): string => path.join(os.homedir(), ".codex", "sessions");

/** The most recently modified `*.jsonl` under the sessions tree, or null. Codex nests them by
 * date (`2026/07/28/rollout-….jsonl`), so this walks rather than reading one directory. */
export function newestRolloutFile(root: string, now_ms: number): string | null {
  if (!existsSync(root)) return null;
  const found: { file: string; stamp_ms: number }[] = [];
  const walk = (dir: string, depth: number): void => {
    const MAX_DEPTH = 5;
    if (depth > MAX_DEPTH) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      // A file stamped in the future would win forever; treat it as now rather than trusting it.
      found.push({ file: full, stamp_ms: Math.min(statSync(full).mtimeMs, now_ms) });
    }
  };
  try {
    walk(root, 0);
  } catch {
    // an unreadable subtree costs whatever it held, not the feature
  }
  return found.reduce<{ file: string; stamp_ms: number } | null>((best, c) => (best === null || c.stamp_ms > best.stamp_ms ? c : best), null)?.file ?? null;
}

/** The last lines of a file. The first is dropped: starting mid-file almost always lands inside a
 * line, and a half line is not JSON. */
export function readTailLines(file: string): string[] {
  let fd: number | null = null;
  try {
    const size = statSync(file).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    if (length <= 0) return [];
    const buffer = Buffer.alloc(length);
    fd = openSync(file, "r");
    readSync(fd, buffer, 0, length, start);
    const lines = buffer.toString("utf8").split("\n");
    return start > 0 ? lines.slice(1) : lines;
  } catch {
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
