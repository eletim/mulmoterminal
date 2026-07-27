# Clip the cockpit header's directory from the front

Issue: #944

## Why

A path is identified by its **tail**. `~/ss/llm/mulmoterminal2` and `~/ss/llm/mulmoclaude` share
everything but the last segment, so the last segment is the only part worth the pixels — which is
why the grid cell header (`TerminalCell.vue`'s `cell-dir`) has always clipped from the front:
`direction: rtl` puts the ellipsis at the start, `unicode-bidi: plaintext` keeps the path text in
logical order.

`CockpitHeader.vue` — shared by the expand-mode roster (a 360px column) and the filmstrip
thumbnails — was styled with a plain `truncate`, so it clipped from the **end** instead. The
narrower the column, the less of the path identified anything.

`formatCwd(cwd, home, 44)` already trims by character count with a leading `…`, which hid the gap:
the string looks front-clipped, and then CSS eats the far end of it anyway.

## What

`cellChromeClasses.ts` grows `DIR_TRUNCATE_FRONT` (`truncate text-left [direction:rtl]`) next to the
existing `CELL_DIR_PATH`, and `CELL_DIR` is rebuilt from it. `CockpitHeader.vue` uses the same pair,
with the path text in an inner span.

`text-left` belongs **in** the constant: rtl flips the default alignment as well, so a path short
enough to fit drifts to the trailing edge without it. `CELL_DIR` carried its own `text-left` and was
therefore fine; every hand-rolled copy of the combination has to remember it, and one didn't (see
below). Codex caught the same thing on the first draft of this change.

The bar also gains `:title="cwd"` — the full path, since the head is now the part you can't read.
`cell-dir` already carries the same title.

The worktree diff panel's file list (`TerminalCell.vue`, `cell-diff-file`) had the same two omissions
— no `text-left`, no `CELL_DIR_PATH` — so it moves onto the constant too.

Not touched: `TerminalCell.vue:1043`/`:1051` spell the combination out inline but do include
`text-left`, so they render correctly; folding them in is a cleanup, not a fix.

## Test

`test/src/components/CockpitHeader.spec.ts` pins the direction (rtl on the box, plaintext on the
path text) and the title, so a future edit can't silently drop back to tail-clipping.
