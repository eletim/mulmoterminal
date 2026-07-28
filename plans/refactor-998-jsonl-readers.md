# One place to read a transcript without holding it in a string

Part of #998. **Phase 1 of 4 — no behaviour change.**

## Why

`fs.readFile(file, "utf8")` throws `Cannot create a string longer than 0x1fffffe8 characters` past
~512 MB, whatever the file contains. Confirmed on this machine against a real 585 MB transcript.

Nine read paths take a transcript whole and catch the failure, so the longest-running sessions
report as the emptiest ones — no roster badge, no timeline, zero cost. #998 has the full table.

The fix is per-path (tail for the last turn, a line stream for a scan), but two of those readers
**already exist** and neither is where the callers can find it:

- a line stream in `server/session/decision-scan.ts` (#997)
- a tail reader in `server/agents/codex-rollout.ts`

Left there, the next path to be fixed either imports from an unrelated module or writes a third
copy. So this phase moves both into one place and changes nothing else.

## What

`server/infra/jsonl-file.ts`, beside the existing `read-text-file.ts`:

- `forEachJsonlLine(file, onLine)` — every line, in order, nothing materialised. A callback rather
  than a returned array because that is the point: a summary keeps a handful of fields out of
  hundreds of megabytes.
- `readTailLines(file, tailBytes = 256 KB)` — the end of a file, dropping the first line when the
  read started mid-file (that boundary lands inside a line, and half a line is not JSON).

The two existing call sites now use it. `codex-rollout.ts` no longer exports a reader; `index.ts`
imports it from `infra/` instead.

## Measured on the real file

Against the 585 MB transcript that `readFile` cannot open at all:

| | result |
| --- | --- |
| `forEachJsonlLine` | 17,598 lines / 574 MB of text in **1.66 s**, RSS 328 MB |
| `readTailLines` | last 10 lines in **0 ms** (it touches 256 KB) |

The 0 ms is what Phase 2 is for: the roster only needs the last turn, and today it tries to read
585 MB to get it.

## Tests

`jsonl-file.spec.ts` covers what the callers depend on rather than the happy path alone: a final
line with no trailing newline, CRLF (a tool_result carrying `\r\n` must not split a line), an empty
file, a missing file (tail returns none, the stream rejects), and the boundary case that the whole
thing exists for — a tail that starts mid-file drops its first, partial line, but keeps it when the
file fits in the window.

## Next

2. the four "last turn" readers → tail
3. the three whole-file scans → line stream
4. the title reader → head
