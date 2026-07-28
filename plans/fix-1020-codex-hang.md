# Cut a hung review short instead of waiting out the cap

Issue: #1020

## Why

`codex exec` does not run slow on a bad run — it **stops**. The log of the timed-out attempt on
#974 reads:

```text
22:52:27  [{"url":".../issues/comments/5097680212", …   ← finished reading the PR thread
          (fifteen minutes with no output at all)
23:07:24  ##[error]The operation was canceled.
23:07:24  Terminate orphan process: pid (2418) (codex)
```

It got as far as the "read the existing thread" step the prompt asks for, went to the model, and
never came back. The job then burned its whole `timeout-minutes` and left an orphan `codex` behind.

That reframes #960, which raised the cap from 10 to 15 minutes on the theory that reviews were
occasionally slow. **A hang always reaches the cap**, whatever it is set to — so that change bought
five more minutes of waiting and nothing else. It happened four times in two days (#945, #951,
#952, #974), and every rerun of the same commit finished in about a minute.

## What

The `codex exec` call gets its own deadline (`CODEX_TIMEOUT_SECONDS`, 300) and one retry. A healthy
review takes 30s–2min, so five minutes is well clear of normal and far below the job's cap.

Only a **timeout** is retried, and that means **124 or 137**. `timeout(1)` reports 124 when the
child dies on TERM and 137 when it ignores TERM and `--kill-after` has to SIGKILL it. 137 is the
one that matters here: a process wedged waiting on the model is exactly the kind that does not take
TERM. Measured — a child trapping TERM exits 137, not 124. Any other non-zero status is codex
failing on its own terms (a bad key, a `gh` error), where a retry would just spend another five
minutes reaching the same conclusion.

The job's 15-minute cap stays as the backstop — two attempts plus overhead fit inside it.

## The bug I nearly shipped

The first draft wrote:

```bash
if timeout … codex exec …; then exit 0; fi
status=$?
```

After an `if`, `$?` is the **if statement's** status, not the command's — so `status` would have
been 0 every time and the 124 check would never have fired. It reads correct and is wrong. Now:

```bash
status=0
timeout … codex exec … || status=$?
```

## How this was checked

Workflow changes only run in CI, so the retry block was extracted and run locally against stubs, a
case per branch:

| stub | result |
| --- | --- |
| hangs forever | two attempts, then fail (exit 1) |
| ignores TERM, hangs forever | two attempts (137 each), then fail |
| **exits 124 itself, immediately** | **no retry** — not a deadline, see below |
| **exits 137 itself, immediately** | **no retry** |
| exits 3 immediately | **no retry**, exit 3 |
| succeeds | exit 0, one attempt |
| hangs once, then succeeds | **exit 0 on attempt 2** — the case actually being hit |
| ignores TERM once, then succeeds | **exit 0 on attempt 2** |

Plus `bash -n` on the step's script and a YAML parse asserting the prompt still carries the
`CODEX VERDICT:` marker the `gh-review-loop` skill reads.

## Review follow-up

**CodeRabbit: `timeout` cannot tell its own deadline from the child exiting 124/137.** True — the
codes are indistinguishable, so the *elapsed time* decides instead: a run that gave up before the
deadline was codex failing on its own terms, not a hang, and retrying it would spend another five
minutes reaching the same answer. Two stub cases pin it.

**CodeRabbit: a retry can duplicate comments.** Real: if an attempt posts findings and then hangs,
the retry runs the same prompt again. The prompt already tells the review to read the existing
thread before posting; it now also says that an earlier attempt **of this same run** may have
posted before being cut short, and to leave those comments alone rather than repeat them. Not
airtight — a truly idempotent poster would need a per-run marker — but the observed hang (#974)
happens *before* anything is posted, so this covers the case at hand without adding machinery.

**Codex: 137 was being treated as "not a timeout".** Correct, and it would have defeated the whole
change: with `--kill-after` set, a child that ignores TERM exits 137, and a process wedged on a
model call is precisely one that ignores TERM. The first version retried only on 124, so the most
likely real-world hang would have been classified as a genuine failure and not retried. Measured
both paths locally before fixing, and added the two TERM-ignoring cases to the table above.

## What this does not do

It does not explain **why** codex hangs — whether the model call is left hanging with no client-side
timeout, or something upstream stalls. That stays open in #1020. This only stops a hang from
costing fifteen minutes and a manual rerun.
