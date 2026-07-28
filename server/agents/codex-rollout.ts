// Finding the newest Codex rollout on disk and reading its tail. The parsing lives next door in
// codex-rate-limits.ts; this half is the filesystem, kept apart so the rules stay testable without
// one.
//
// Only the TAIL is read. A long Codex session's rollout runs to megabytes, the windows are written
// on nearly every event, and the one that matters is the last — so reading the whole file to reach
// its end would be the most expensive way to get the cheapest data source we have.
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Enough to hold several events even when one carries a large payload. A rollout whose last
// rate_limits sits further back than this simply reports nothing, which the gauge already handles.

export const codexSessionsDir = (): string => path.join(os.homedir(), ".codex", "sessions");

// The walk below is synchronous and covers the whole sessions tree — hundreds of files on a
// long-standing install — while the refresh route calls it on every poll. Unthrottled, that blocks
// the event loop (every terminal socket with it) on a schedule. Which file is newest changes only
// when Codex starts one, so re-walking within this window can only produce the same answer.
const NEWEST_FILE_CACHE_MS = 30_000;
let cached: { root: string; file: string | null; at_ms: number } | null = null;

/** The most recently modified `*.jsonl` under the sessions tree, or null. Codex nests them by
 * date (`2026/07/28/rollout-….jsonl`), so this walks rather than reading one directory. */
export function newestRolloutFile(root: string, now_ms: number): string | null {
  if (cached && cached.root === root && now_ms - cached.at_ms < NEWEST_FILE_CACHE_MS) return cached.file;
  const file = walkForNewest(root, now_ms);
  cached = { root, file, at_ms: now_ms };
  return file;
}

/** Uncached, so a test can exercise the walk itself without reaching through the cache. */
export function walkForNewest(root: string, now_ms: number): string | null {
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
