# Colour the launch form's recent-dir chips

Issue: #949

## Why

A directory that configures colours in `.mulmoterminal.json` is identified by them everywhere it
matters — the cell header, the frame, the badge, the status dot. Everywhere except the one screen
where you *choose* a directory: the launch form's recent-dir chips are all the same grey. So the
colour you set up to recognise a project at a glance is missing at the moment you pick it, and the
chip's label (a bare basename — `proj`, `web`, `api`) is doing the work alone.

## What

Each chip gets a 3px stripe down its leading edge in that directory's colour.

A 6px stripe, plus a wash over the chip's background and border in the same colour.

**The wash is dropped while a session is running there.** That chip's blue means "a session is
already here" — a state, not an identity. Two meanings on one background is how both stop being
legible, so the running chip keeps its blue and carries the directory's colour on the stripe
alone; the two facts stay readable side by side. A directory that configured no colour renders
exactly as it did before, running or not.

The first cut was the stripe alone at 3px. Seen in the running app that read as too quiet to
serve its purpose, so the stripe doubled and the wash was added — 14% over the chip, 55% on the
border, both named constants in `dirChipColor.ts` for the next time that judgement changes.

**Which colour.** `dirChipColor` takes the first that is set: `headerColor`, `badgeColor`,
`cellColor`, `dotColor` — the order the grid makes them visible in. A chip is too small for more
than one. Non-hex values are skipped rather than passed to a style binding.

## How the colours arrive

The chips show up to N directories at once, none of which has a cell running `useDirConfig`. That
is the same shape `useDirPriorities` already solved for the grid's priority sort: subscribe to a
SET of directories, keep one field, update live off the `dir-config` invalidation channel.

Rather than write a second copy of it, that function is generalised to `useDirField(cwds, pick)`;
`useDirPriorities` and the new `useDirColors` are both one line on top of it. Editing a
`.mulmoterminal.json` therefore recolours the chips live, with no remount and no new plumbing.

Subscriptions are dropped once the cell launches — the chips are gone by then, and their fetches
would otherwise outlive the form for the rest of the session.

## Incidental

`HEX_COLOR_RE` existed twice (`dirBadge.ts`, `cellHeaderStyle.ts`) and this change needed a third
reader, so it moves to `hexColor.ts` and both existing copies now import it.

## Tests

- `dirChipColor.spec.ts` — the priority order, the empty case, and non-hex rejection.
- `useDirConfig.spec.ts` — a `useDirColors` block: resolve-and-omit, live recolour on a config
  write, and release when a directory leaves the set.
- `TerminalCell.spec.ts` — the chip actually paints the stripe, and an unconfigured dir has none.
