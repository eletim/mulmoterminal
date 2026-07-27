# The directory name badge on every grid cell

Issue: #914 (follows #902 / #906 / #909)

## The gap

`.mulmoterminal.json`'s `name` renders as a coloured chip in a cell header. It appeared on Claude
cells and the single view only; a **shell or command cell in the same directory showed nothing**.

Not a regression — `git log -S "dirConfig.name" -- src/components/LauncherCell.vue` returns nothing.
It was never written. #906 gave those cells the terminal's palette and font but left the badge out,
which produced the odd half-state: the colours and font change, the project label doesn't.

It also cost real debugging time. A missing badge and a missing config look identical from the
outside, which is part of why #902 took several rounds to read correctly.

## Why a component rather than two more copies

The markup existed twice. Adding it to two more cells would make four. CLAUDE.md is explicit:
repeated utility runs are extracted as a shared **component**, never re-pasted.

`src/components/DirBadge.vue` takes `name` + `color` and renders nothing without a name. The three
grid cells use it; `badgeStyleFor` (`dirBadge.ts`) keeps doing the contrast maths it already did.

`TerminalCell`'s own `dirBadgeStyle` computed died with the change and is removed — knip would have
caught it, but it is worth not leaving behind.

### The single view keeps its own

`Terminal.vue`'s badge is `max-w-[16ch] px-2 leading-[1.6]`; the grid's is
`max-w-[14ch] flex-none px-[7px] font-sans`. That difference is deliberate — the single view's
header has more room. Forcing one component onto both would change how it looks, which is not what
this issue asked for. Two variants, honestly labelled, beats one variant that silently restyles a
screen.

## `useDirConfig` comes back to two cells

#911 removed it from `LauncherCell` / `CommandCell` because the terminal resolves its own canvas
settings now. The badge is **chrome**, and #911's line was explicit that chrome stays the host's
job — which is exactly why `TerminalCell` and `App.vue` kept theirs. So this is that line being
applied, not walked back.

## Tests

`test/src/components/dirBadgeCells.spec.ts` — the component (renders, disappears without a name,
derives a readable text colour) plus one spec per grid cell asserting the badge actually reaches
the header.

Named `dirBadgeCells` deliberately: `dirBadge.spec.ts` already exists for the style helper, and on
a case-insensitive filesystem `DirBadge.spec.ts` would have silently overwritten it while remaining
a separate file on Linux CI.

The two cell specs were confirmed to **fail without the wiring** before being kept.
