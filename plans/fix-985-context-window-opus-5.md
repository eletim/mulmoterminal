# `ctx` reads above 100% because the window table has no `opus-5`

Issue: #985

## What it is

`Opus · ctx 290%` on a real session. `CONTEXT_WINDOWS` in `ModelContextBadge.vue` is an ordered
substring list, first hit wins, and `claude-opus-5` matches none of `opus-4-6` / `opus-4-7` /
`opus-4-8`. It falls through to the `{ match: "opus", tokens: 200k }` fallback and is divided by
200,000 instead of 1,000,000 — exactly 5× too large, which is where 580k used reads as 290%.

`sonnet-5` is in the list. `opus-5` was never added alongside it.

The file's own comment predicted this: *"Add new 1M model ids here when they ship — otherwise a
full session over-reports (e.g. a 1M model shown against 200k reads as ~500%)."* The mechanism is
working as designed; the table was not kept current.

## The fix

1. **`{ match: "opus-5", tokens: MILLION_TOKENS }`, before the `opus` fallback.** Order is load
   bearing in a first-hit list.
2. **A percentage over 100% is treated as a gap in the table, not as a number.** The badge shows
   `ctx ?` and the tooltip says the window is unknown.

Point 2 is the part worth arguing about, so: this table needs a hand edit every time a model
generation ships, and the next omission is a matter of when. Three ways to fail, and only one of
them is acceptable:

- **Print the wrong number** (today). 290% is confidently, precisely wrong. A reader who trusts
  the badge mismanages a session on it.
- **Clamp to 100%.** Worse than today — the failure becomes invisible, and "full" is a plausible
  enough reading that nobody files an issue.
- **Say we don't know.** `ctx ?` is visibly odd, so it still gets reported (this bug was found
  precisely *because* 290% looked wrong), but nobody acts on it as if it were a measurement.

We already refuse to guess a window for an unknown model — no `ctx` at all in that case. An
impossible percentage is the same admission arriving later, so it gets the same answer.

## Audit of the rest of the table

Checked against the current model list rather than fixed one row and moved on. `opus-5` is the only
gap: Fable 5, Mythos 5, Opus 4.6/4.7/4.8 and Sonnet 4.6/5 are all present at 1M; Haiku 4.5 (200k)
and the pre-4.6 Opus/Sonnet generations (200k) are correctly served by the fallbacks.

## Where the code goes

The decision — which window, what percentage, what to show when neither is knowable — moves out of
`ModelContextBadge.vue` into `src/components/modelBadge.ts` and is unit tested directly, per
CLAUDE.md's rule that logic must not live where only a mount can reach it. The component keeps the
markup and one `computed` that reads the result. The existing mount spec keeps the wiring assertions
(renders / does not render, tooltip is attached); the table and the arithmetic are tested without
mounting.

`modelBadge.ts` rather than `modelContextBadge.ts`, because its spec would then be
`modelContextBadge.spec.ts` — the same file as `ModelContextBadge.spec.ts` on a case-insensitive
filesystem. macOS would silently merge the two; Linux CI would not, so the break would only ever
show up on a developer's machine.
