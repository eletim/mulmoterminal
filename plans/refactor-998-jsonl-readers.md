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

4. the title reader → head

---

# Phase 2 — the four "last turn" readers

`readLatestResponse`, `latestUserPrompt`, `sessionLastTurn` and `codexLastTurn` all wanted the newest
turn and all read the whole file to find it. They now read the tail.

`session-reads.ts` already said this was the answer, in a comment written for #865:

> Reading only the file's tail would lift the cap altogether and is the obvious next step if anyone
> hits this in practice.

Someone did.

## The window is 4 MB, not 256 KB

The tail reader came from the codex rollout, where 256 KB was plenty. On a **Claude** transcript it
is not: one record can hold an entire tool_result, and on the 585 MB file here the last 256 KB is
**nine records — not one complete turn**. Measured:

| window | records | last turn found |
| --- | --- | --- |
| 256 KB | 9 | no |
| 1 MB | 9 | no |
| **4 MB** | **139** | **yes, in 15 ms** |
| 16 MB | 612 | yes, 59 ms |

Across the six largest transcripts on this machine 4 MB yields 110–1000 records, so it covers a turn
with room to spare. A spec pins this with deliberately fat records, since the failure it prevents —
a window that is technically working but too small to contain an answer — looks exactly like an
empty session.

## Measured on the real file

The 585 MB transcript, which `readFile` cannot open at all:

```text
records=139 in 13ms
prompt: "This session is being continued from a previous conversation that ran "
reply : "Push 完了。PR コメントを投稿し、並行して他の全 open PR の失敗状況を確認します。"
```

Real content, 13 ms. Before this it was an exception caught into an empty turn.

## `LAST_TURN_MAX_BYTES` is now dead

The 64 MB refusal existed because reading whole was unaffordable. Nothing sets `tooLarge` any more.
The constant and the flag stay for the moment: `tooLarge` reaches the UI (`useHandoff`,
`codeBlockCopy`), and removing a wire field is its own change rather than a rider on this one.


---

# Phase 3 — the three whole-file scans

`readSessionSummary`, `sessionTimeline` and `readFileCost` each needed every record, so a tail
cannot serve them. They stream instead.

## Nothing re-implements a rule

Every one of these was already a fold over records; the only thing holding it to an array was
`parseJsonl(readFile(...))`. So each existing `…FromParsed` rule is kept exactly as it is and fed a
window instead of the file:

- **`createSummaryScan`** — the fields that need every record (usage, user turns, the AI title)
  accumulate as records arrive; the ones describing the END of the session (last prompt, last reply,
  model/context, current tools) read a bounded 400-record tail. Each is still computed by the
  original function, on a one-record or tail-sized window.
- **`timelineEventsIn(record)`** — the per-record half of `timelineFromJsonl`, which now calls it.
  The caller keeps only the newest 300 events, which the payload was already capped to: holding the
  whole transcript in order to throw most of it away was the expensive part.
- **`createCostScan`** — the same accumulation one record at a time. `costForUsage` is untouched,
  so pricing lives in one place.

## Equivalence is the test

`summary-scan.spec.ts` asserts the scan against **the original functions on the same records**
rather than against hand-written expectations, so the two cannot drift: empty session, one exchange,
several turns, a turn in progress, competing AI titles, records that are neither user nor assistant,
an assistant turn with no usage — and the two properties that pull in opposite directions:

- usage and turn counts must see **every** record (a tail-only fold would under-report a long
  session's cost)
- last prompt / last reply must describe the **end** (and not be dragged back by what came before)

## Measured on the real file

One pass over the 585 MB transcript, all three scans at once:

```text
2557ms, RSS 475MB
  userTurns : 95
  usage in  : 6,107 tokens
  model     : claude-opus-4-8  ctx=69,820
  cost      : $1072.63 (0 unpriced)
  timeline  : 1539 events
```

Every one of those was empty or zero before — including the cost, which #998 noted was being
summed into the project total as **$0**.
