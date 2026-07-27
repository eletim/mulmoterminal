# Raise the Codex review job's timeout

Issue: #960

## Why

`timeout-minutes: 10` cancelled the review step on #945, #951 and #952 inside two days. Each time
a plain rerun of the **same commit** finished in one to two minutes (#952's took 1m56s), and the
ordinary runs on other branches finish in well under that.

So the job is not hanging — it is occasionally slow, and the cap is sitting inside the slow tail
rather than above it. What a timeout is for is stopping a hang; cutting off a run that would have
finished costs a full re-review round trip on a PR that was otherwise ready to merge, and shows it
as a red check in the meantime.

## What

15 minutes, with the three cancellations recorded in a comment beside it so the next person to
consider lowering it knows what the number is holding back.

Nothing else changes: the step, its concurrency group, and the `CODEX VERDICT` contract the
`gh-review-loop` skill reads are untouched.
