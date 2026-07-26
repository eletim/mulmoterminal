# Grid ordering from `.mulmoterminal.json` — `orderPriority`

Issue: #876

## The ask

> 各レポジトリの `.mulmoterminal.json` に `orderPriority` を数字で書くと、grid view のときにその順番で並べる機能あると良いね

## What is already there

Ordering is decided in exactly one place — `orderCells()` (`src/components/gridTabs.ts:370`) —
and both the grid and the cockpit roster read it, deliberately, so the two can't drift (#720).

```ts
if (mode !== "auto") return cells;   // "manual": the hand-arranged list as-is
return stableSortBy(attentionRank)   // "auto": blocked → done → idle → working → launch cells
```

So the feature does not land on a blank slate: **drag-to-reorder already exists** in `manual`
mode. That is the design question the request runs into, and the user chose the answer.

## Decision: a third mode, not a change to the existing two

`SortMode` gains `"priority"`; the toolbar toggle cycles `auto → manual → priority`.

Chosen over the two alternatives because it is the only one that is **inert until used**:

- *Second sort key inside `auto`* — attention rank first, `orderPriority` within each bucket.
  Rejected: it silently changes what existing `auto` users see the moment a directory grows an
  `orderPriority`, and it can never express "just show me my configured order".
- *Replace the base order* — closest to the literal request, rejected because it **fights
  drag-to-reorder**: a dragged cell whose directory sets `orderPriority` would snap back, so the
  existing manual arrangement quietly stops working.

With a third mode, a user who writes no `orderPriority` sees byte-identical behaviour.

## Spec

- **Ascending** — smaller number first.
- **Unset sorts last**, so adding the key to one directory doesn't push every other cell around.
- **Stable within equal values** — ties keep the current (manual) order, which also covers the
  several-cells-in-one-directory case, since priority is a property of the *directory*.
- Empty launcher cells stay last, as they already do in `auto`.

## Work

1. **`orderPriority` onto the dir-config route** — `config-schema.ts` (lenient field + strict
   `writableDirConfigSchema` entry) → `dir-config.ts` (`loadDirConfig`, `publicDirConfig`) →
   `common/dirChrome.ts` → `useDirConfig.parse`. The same path `fontSize` took in #866, so the
   shape is already proven. An integer; no clamping (unlike a font size there is no unusable
   value), non-numeric → null → "unset".
2. **Aggregate the priorities in `GridView`.** The grid needs a value for **every** cell, not
   just the ones on the current page — the same constraint `statusForSort` documents. Build a
   `cwd → orderPriority` map from `fetchDirConfig` (already per-cwd cached and invalidated by the
   `dir-config` pubsub channel, so an edit re-sorts live without a watcher).
3. **`orderCells()` handles the new mode** — sort by priority, unset last, stable on ties.
   Pure function, extended in place, so the roster inherits it.
4. **`asSortMode`** (`gridTabs.ts:417`) accepts `"priority"`; anything unknown still falls back
   to `"manual"`, so an old/corrupt persisted state is unaffected.
5. **The toolbar button is the fiddly part.** It is boolean today: `autoSort?: boolean`, with
   `:active="autoSort"` and `:aria-pressed="autoSort"` (`AppToolbar.vue:145`). Three states can't
   ride a boolean, and `aria-pressed` is wrong for a 3-way cycle — it must become a mode-carrying
   prop with a distinct icon + label per mode, and the a11y annotation changed accordingly.

## Tests

- `orderCells` in `"priority"` mode: ascending; unset last; ties stable; launch cells last;
  mixed set/unset; every cell unset (≡ manual order).
- `asSortMode` round-trips `"priority"` and still falls back to `"manual"` for junk.
- The dir-config field: valid, non-numeric, negative, zero, absent.
- The cwd→priority aggregation covers off-page cells.

## Docs

`README.md`, `docs/guide/{en,ja}/config.md` (both languages), and the
`mulmoterminal-config` skill, which writes these files and would otherwise not offer the key.
