// Reading a JSONL transcript without holding it in one string.
//
// A transcript on a working machine reaches 585 MB, and `fs.readFile(file, "utf8")` throws
// "Cannot create a string longer than 0x1fffffe8 characters" past ~512 MB — regardless of what
// the file contains. Every reader that took the whole file caught that and reported "nothing",
// so the longest-running sessions read as the emptiest ones (#998).
//
// Two shapes cover what the callers actually need, and neither is new: this module is where the
// line stream from decision-scan.ts and the tail reader from codex-rollout.ts now live together,
// so a reader picks one instead of writing a third.
import { createReadStream, closeSync, openSync, readSync, statSync } from "node:fs";
import readline from "node:readline";

/** Enough of the end to hold the last turn, with room to spare. */
const DEFAULT_TAIL_BYTES = 256 * 1024;

/** Every line, in order, without ever materialising the file. `onLine` is called with each line
 *  as it arrives, so the caller decides what to keep — which is the point: a summary keeps a
 *  handful of fields out of hundreds of megabytes. */
export async function forEachJsonlLine(file: string, onLine: (line: string) => void): Promise<void> {
  const input = createReadStream(file, "utf8");
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) onLine(line);
  } finally {
    lines.close();
    input.destroy();
  }
}

/** The last lines of a file. The first is dropped when the read started mid-file: that boundary
 *  almost always lands inside a line, and half a line is not JSON. Synchronous and bounded — it
 *  reads `tailBytes`, not the file. Returns [] for anything it cannot read, since every caller
 *  wants "no recent turn" rather than an exception. */
export function readTailLines(file: string, tailBytes: number = DEFAULT_TAIL_BYTES): string[] {
  let fd: number | null = null;
  try {
    const size = statSync(file).size;
    const start = Math.max(0, size - tailBytes);
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
