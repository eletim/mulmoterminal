# Resolve directory settings inside Terminal.vue

Issue: #909 (follows #902 / #906)

## Why

#902 was "two of four hosts forgot to pass four props". #906 passed them. The **shape that made
forgetting possible** was untouched, and it had already claimed two victims — `theme`/`colors`
originally, then `fontSize` again in #860/#866.

Four components each resolved the same config and forwarded the same four props:

| | `useDirConfig` | `dir-theme` / `dir-colors` / `dir-font-size` / `dir-font-family` |
|---|---|---|
| `App.vue` | yes | yes |
| `TerminalCell.vue` | yes | yes |
| `LauncherCell.vue` | yes (#906) | yes (#906) |
| `CommandCell.vue` | yes (#906) | yes (#906) |

Worth being precise about what kind of duplication this is: jscpd measures **0.19%** token overlap
across the three cells (one 41-token button fragment; 0% in TypeScript). They are genuinely
different components and should not be merged. The repetition is in the **wiring**, not the code.

## What

`Terminal.vue` resolves it from its own cwd; the four props are deleted.

It already had the cwd, and a better one than its hosts hand it:

```ts
const serverCwd = computed(() => conn.connView.get(slotKey)?.serverCwd ?? props.cwd ?? null);
```

That is the **server-confirmed** directory — the server may have rejected the requested one and
started elsewhere, in which case the host's copy is wrong and this is right.

- A fifth cell type cannot forget props that no longer exist.
- `useDirConfig` shares one fetch per cwd, so a host still reading the config for its own chrome
  (badge, header tint) costs nothing extra.
- `LauncherCell` / `CommandCell` drop `useDirConfig` entirely — they never needed it for themselves.

## What stays a prop

`dirName`, `dirBadgeColor`, `dirHeaderColor`, `dirHeaderTextColor`, `dirButtonColor`. The **chrome
around** the terminal is the host's to style — each host has different header markup — while the
**canvas** belongs to this component. That line is why the change is a net simplification rather
than a move of the same tangle one level down.

## Tests

The two specs added in #870/#906 asserted *props were passed*. Those props are gone, so they are
deleted rather than adapted — they described a mechanism, not a behaviour.

Replaced by `TerminalDirFontApply.spec.ts`, driven the way the real app drives it: answer
`/api/dir-config` and assert what reaches `attach()` / `setFont()` / `setTheme()`. Covers the
font, the palette, the no-config case (which must NOT push a redundant re-fit), and an invalid
stack. Since every host passes `cwd`, this one file now covers all four.

Both behavioural specs were confirmed to **fail against the pre-refactor `Terminal.vue`** before
being kept.
