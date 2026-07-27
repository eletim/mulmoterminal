# The 5h / 7d rate-limit gauge, in the grid's global header

Issue: #387 (PR #388 built this once as an opt-in toolbar chip and was closed unmerged)

## What is different this time

PR #388 put the numbers in a `title` attribute — a **tip**, visible only on hover — and made the whole
feature opt-in. The ask now is the opposite: **both windows, always on screen**, in the grid's
global header, because the alternative is typing `/usage` every time. Codex is in scope too.

## Where the numbers come from — measured, not assumed

Three routes exist for Claude. All three were checked today rather than taken from #387, which is
ten days old against a CLI that moves weekly.

| | route | token cost | terminal rows | credential access | verified |
|---|---|---|---|---|---|
| a | statusLine injected into every visible session | none | **one per cell** | none | #388 measured the row |
| **b** | **statusLine injected into a hidden probe session** | **one small query per refresh** | **none** | none | **works, today** |
| c | `GET /api/oauth/usage` with Claude Code's OAuth token | none | none | **reads the user's credential** | no — 401 on the expired on-disk token |

**(b) is what this builds.** It was the only one confirmed end-to-end on this machine:

```json
"rate_limits": {
  "five_hour": {"used_percentage": 27, "resets_at": 1785198000},
  "seven_day": {"used_percentage": 83, "resets_at": 1785448800}
}
```

Facts that decided it:

- **`claude -p` does not invoke the statusLine.** A headless one-shot cannot harvest the payload;
  the probe has to be an interactive PTY session. Measured.
- **The field is absent until the session's first API response.** An idle probe reports `null`, so
  the probe must be asked something. Measured — the first attempt returned `null` for exactly this
  reason, and looked like a missing feature until the prompt actually submitted.
- **(c) is not the free lunch it looks like.** The on-disk `accessToken` had expired; the live one
  is in the macOS Keychain, so (c) means MulmoTerminal reads — and refreshes — the user's OAuth
  credential. That is the largest permission this product would take, in exchange for a query it
  can otherwise pay for in tokens.
- Upstream lost `rate_limits` from the payload once already
  ([#40094](https://github.com/anthropics/claude-code/issues/40094),
  [#45133](https://github.com/anthropics/claude-code/issues/45133), both closed unfixed). It is back
  now. **The gauge has to survive the field vanishing again** — absent means "show nothing", never
  "0% used".

**Codex needs no probe at all.** It writes the same two windows straight into its rollout file:

```json
"rate_limits": {"primary": {"used_percent": 2.0, "window_minutes": 300, "resets_at": …},
                "secondary": {"used_percent": 1.0, "window_minutes": 10080, "resets_at": …}}
```

`window_minutes` 300 and 10080 are the 5h and 7d windows under different names. Reading the newest
rollout costs nothing, so Codex is always live regardless of what Claude's probe is doing.

## The probe only runs while someone is looking

The gauge measures a budget, and the probe spends that budget to measure it. That is acceptable
only if it stops when nobody benefits.

So the probe is **demand-driven, not scheduled**: the browser polls `POST /api/rate-limits/refresh`,
and a probe is triggered only when a client has asked AND the stored value is older than the
staleness window. Nobody with the app open → no queries overnight, no cost for a user who never
opens the grid.

The poll is a POST rather than a side effect on the GET because `same-origin-guard.ts` says so
outright: safe methods are not gated, so a GET that started a probe could be fired by any page the
user happens to visit, at their expense.

One probe serves everything: the windows are account-wide, so cell count is irrelevant.

## Shape

| Where | What |
|---|---|
| `server/agents/statusline.ts` | `extractRateLimits` (from #388) + the injected command. **No `statusLineConfigured` this time** — we inject only into our own probe, so there is no user statusLine to clobber, which is a whole class of risk (a) had and (b) does not |
| `server/agents/codex-rate-limits.ts` | newest rollout → the same shape, keyed off `window_minutes` |
| `server/agents/rate-limit-store.ts` | last-known per agent, with the staleness rule that decides whether to probe |
| routes | `POST /api/rate-limits` (the probe reports), `POST /api/rate-limits/refresh` (the UI polls; asking is what permits the next probe), `GET /api/rate-limits` (a pure read) |
| `src/components/…` | both windows, always rendered, in the grid header |

## Verification

Pure functions for every decision — extraction from both payload shapes, staleness, and what the
header shows when a window is missing. The probe's own spawn is wiring, checked by hand.

The one thing unit tests cannot cover is that the probe still harvests a payload after a Claude
Code update. That is what made #387 stale in the first place, so the extractor treats every field
as optional and the gauge renders nothing rather than a zero.
