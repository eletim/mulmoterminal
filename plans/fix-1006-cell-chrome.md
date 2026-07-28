# One place a cell gets its directory's chrome

Issue: #1006

## Why

The six chrome colours (`headerColor` / `headerTextColor` / `cellColor` / `cellBorderColor` /
`dotColor` / `buttonColor`) reached the Claude cell and nothing else. In the Shell (launcher) and
Command cells only `name` and `badgeColor` applied — the CSS variables they read were never
defined, so every class fell through to its `var()` default.

The report is precise about the mechanism, and it is worth naming the pattern rather than the bug:

- #279 / #281 added the colours, wired into the Claude cell
- #902 found the same hole for `theme` / `colors` / `fontSize` / `fontFamily`
- #914 found it for the name badge
- #1006 found it for these six

**Three times, the same omission.** Not carelessness — the design was "each cell type remembers to
wire it up", and forgetting is silent: nothing throws, nothing fails, the colour just isn't there.
`Terminal.vue` already said so in a comment, about the props #909 removed: *forgetting one costs a
silently dead setting*.

So the fix is not "add the missing lines to two files". It is to remove the opportunity.

## What

**`useCellChrome(cwd)`** — a cell asks for its chrome and gets all of it: the config, the frame's
CSS variables, the header's. The three cell types are now one identical line each.

**`Terminal.vue` resolves the header colours from its own `dirConfig`**, like the theme and font it
already resolved (#909). The three `dir-*` props are deleted, and with them the two call sites that
had to remember to pass them (`App.vue`, `TerminalCell.vue`). `dirHeaderColor` no longer appears in
the source at all.

That is what closes the pattern: a new cell type cannot forget to pass something that is no longer
passed, and cannot forget to assemble something it asks for by name.

## Tests

`cellChromeColors.spec.ts` is stated as a grid — **per colour × per cell type**. A cell that misses
the wiring fails saying which colour and which cell. Written before the fix and confirmed failing
for exactly the two cells the issue names, then green after.

The "directory configures nothing" case is there too: no variables at all, so the classes fall
through to the theme.

One trap worth recording: `useDirConfig`'s fetch cache is module-level and outlives a test, so each
case takes a fresh directory. Reusing one cwd served an earlier case's config to a later one and
made the "configures nothing" case fail for the wrong reason.

## Note on the issue's suggested fix

The report offers "add the three sites to both cells", and notes #909 might make the third
unnecessary. As it stood it would NOT have: `Terminal.vue` kept its own `dirConfig` for theme and
font but still built `headerStyle` from props, so the third site was still load-bearing. Finishing
#909 for the colours is what makes it go away.
