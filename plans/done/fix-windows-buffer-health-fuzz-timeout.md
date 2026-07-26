# Windows CI: the buffer-health fuzz test needs its own timeout

Issue: #858

## What was red

`Windows (daily)` failed on main four times today, always on the same test and always the same way:

```
FAIL test/src/composables/terminalBufferHealth.spec.ts > bufferIsShort on a real terminal
     > stays quiet across writes, resizes, resets, alt-buffer switches and scrolling
Error: Test timed out in 15000ms.
```

The leg that fails alternates between node 22.x and 24.x — whichever is slower on that run. Everything
else passes (`1 failed | 4462 passed`).

The run originally reported (30196880838) was **cancelled by concurrency**, not failed; the genuine
failure is the run that superseded it (30197339335).

## Why this is wall-clock, not a defect

Two things separate a slow test from a broken one, and both point the same way here:

- The failure is **always a timeout, never an assertion**. The test's real job is to prove
  `bufferIsShort` never fires on a healthy terminal — a false positive rebuilds a live terminal and
  costs the user their scrollback. That guard never tripped.
- **Linux CI is green on the identical commits.** Only the Windows runner misses the deadline.

## Root cause

The fuzz loop is `SEEDS = 25` × `OPS_PER_SEED = 60` = 1500 steps. Each step asserts the synchronous
buffer shape, then `await`s a `setTimeout(…, 0)` and asserts the settled one — because the probe runs
both mid-stream (on output) and a task later (confirming itself after `fit()`).

So the test's floor is **1500 sequential timer yields**, and a yield costs scheduling latency, not
work. Measured on macOS:

| | |
|---|---|
| 1500 sequential `setTimeout(0)` yields | 1719 ms |
| whole spec file | 2320 ms |

~74% of the runtime is the yields; the xterm operations and assertions are the small remainder. A
Windows runner pays enough more per yield that the floor alone crosses 15s, with the actual work
barely started. That also explains the 22.x/24.x alternation: nothing about the test is
version-sensitive, it is just whichever leg is slower.

## Options considered

1. **Swap `setTimeout(0)` for `setImmediate`** — rejected. xterm continues a long write via
   `setTimeout` internally (`_innerWrite` re-schedules itself), so a check-phase yield resolves
   *before* that pending continuation. The test would keep passing while quietly no longer testing
   the settled state its name claims. A test name that lies is worse than a slow test.
2. **Cut `SEEDS` / `OPS_PER_SEED`** — rejected. That buys the time back out of the fuzz coverage,
   which is the entire reason the negative case is driven against a real xterm instead of hand-built
   shapes.
3. **Run the 25 seeds concurrently** — plausible follow-up, not taken now. The seeds are independent
   (own `Terminal`, and the probe is pure), and overlapping their yield latency would cut wall-clock
   sharply. It restructures a test that is currently correct, for speed we do not need yet; noted in
   the PR rather than bundled into a red-CI fix.
4. **An explicit per-test timeout** — taken.

## The change

One line: `}, 60_000)` on that test, with a comment recording why the baseline does not fit it.

`vitest.config.ts` sets `testTimeout: 15_000`, and its comment says what that number is for — absorbing
load spikes when a dev builds and tests at once, for tests that normally finish in milliseconds. This
test is a different shape: seconds of legitimate work by construction. It wants its own budget rather
than a raised global one, which would dull the ceiling for all 4462 other tests.

60s gives roughly 3x headroom over the worst plausible Windows cost while still catching a genuine
hang, and the job keeps its own 30-minute cap.
