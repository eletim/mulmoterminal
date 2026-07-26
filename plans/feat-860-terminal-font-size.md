# Configurable terminal font size

Issue: #860

## The ask

`fontSize: 14` is hardcoded in the xterm constructor (`src/composables/useTerminalConnections.ts`),
and neither `~/.mulmoterminal/config.json` nor `<dir>/.mulmoterminal.json` has a key for it. Browser
zoom is not a workaround — it desynchronises xterm's cell grid from the canvas, so the cursor and the
wrap points drift.

Requested shape, in the user's words: **"like color, a global setting and a per-repository setting.
If per-repository is hard, global only for now."**

Per-repository is *not* hard — the `.mulmoterminal.json` plumbing already runs end to end for
`theme`/`colors`, so `fontSize` rides the same route. Both are in scope.

## Following the color precedent

`theme` is the model to copy, so it is worth writing down what it actually does:

| | Global | Per-repo |
|---|---|---|
| storage | `localStorage["theme"]` | `.mulmoterminal.json` → `theme` / `colors` |
| authored via | Settings modal swatch picker | editing the JSON |
| server side | *none* — never touches `AppConfig` | `dir-config.ts` → `PublicDirConfig` |
| client side | `useTheme()` → `currentTermTheme()` | `useDirConfig()` → props |
| precedence | fallback | wins (`Terminal.vue:166`) |
| live update | `watch([themeId, dirTheme, dirColors])` → `conn.setTheme` | same watcher |

So "global" here means **Settings UI + localStorage, not `config.json`** — confirmed with the user,
who chose it over the `config.json` wording in the issue body. That also happens to be the better fit
for a font size: localStorage is per-browser, so a phone and a desktop can each hold their own size,
which one shared `config.json` value could not express.

## The one thing color does not have to do

Changing the palette does not move anything. Changing the font size changes the **cell metrics**, so
`cols`/`rows` change and the PTY has to be told. Setting `term.options.fontSize` alone reproduces
exactly the bug the issue reports about browser zoom — a canvas whose cell grid disagrees with the
PTY's idea of the window, i.e. drifting cursor and wrap points.

Every path that changes the size therefore has to re-fit and push the new size:
`term.options.fontSize = n` → `fitAndSyncSize(c)` (which already runs `fitAddon.fit()` and sends the
resize). This is the load-bearing part of the change; the rest is plumbing.

## Shape

Shared constants + the clamp live in `common/` because **all three** sides decide from them (server
validation, the Settings UI's bounds, the client's localStorage read). Per the repo's own rule, a
value both sides use belongs in `common/`, never mirrored.

- **`common/terminalFontSize.ts`** (new) — `TERMINAL_FONT_SIZE_DEFAULT = 14`, `_MIN = 8`, `_MAX = 32`,
  and `normalizeFontSize(input: unknown): number | null` (round, clamp to range, null for anything
  non-numeric). A pure function in its own file, so it is directly testable.
- **`common/dirChrome.ts`** — add `fontSize: number | null` to `DirChrome` + `EMPTY_DIR_CHROME`.
  That interface exists precisely for fields whose type is identical on both sides (`theme`/`colors`
  are excluded only because each side types them differently, which does not apply to a number), and
  all three `DirConfig`s extend it — so adding it here makes it impossible for one side to omit it.
- **`server/config/config-schema.ts`** — `dirFontSizeField` (lenient: clamp, null on garbage) and
  `fontSize` in `writableDirConfigSchema` (strict `int().min().max()`, so the generated
  `dir-config.schema.json` tells an editor the real range at authoring time).
- **`server/config/dir-config.ts`** — parse it in `loadDirConfig`, pass it through `publicDirConfig`.
- **`src/composables/useDirConfig.ts`** — parse it off the wire.
- **`src/composables/useTerminalFontSize.ts`** (new) — mirrors `useTheme`: a module-level `ref`,
  `localStorage["terminalFontSize"]`, validated through `normalizeFontSize` on read.
- **`src/composables/useTerminalConnections.ts`** — `buildTerminal` takes the size; `Conn` remembers
  it (so a rebuilt terminal keeps it, like `c.theme` at line 316); new `setFontSize(key, size)` that
  sets the option **and re-fits**.
- **`src/components/Terminal.vue`** — `dirFontSize` prop, `effectiveFontSize()` =
  `props.dirFontSize ?? global`, passed to `attach()`, plus a watcher mirroring the theme watcher.
- **`src/App.vue:360` / `src/components/TerminalCell.vue:1116`** — the two sites that already pass
  `:dir-theme` also pass `:dir-font-size`.
- **`src/components/SettingsModal.vue`** — a −/＋ stepper next to the theme picker.

Clamp rather than reject on the lenient path: for a continuous numeric preference, honouring the
direction the user asked for beats silently falling back to 14 and looking broken. The strict schema
still flags an out-of-range value where it can be fixed — at authoring time.

## Docs

- `README.md`, `docs/guide/{en,ja}/config.md` (both languages).
- `server/skills/mulmoterminal-config/SKILL.md` — it documents the `.mulmoterminal.json` keys and
  ships the generated JSON Schema, so a new key belongs in its reference.

## Tests

- `normalizeFontSize`: valid, fractional, below/above range, zero, negative, `null`, string, `NaN`.
- `dirFontSizeField` + `dirConfigJsonSchema()` carries `fontSize` with its bounds.
- `loadDirConfig` / `publicDirConfig` round-trip the key; a garbage value falls back to null.
- Resolution: `dirFontSize` wins over the global value; absent dir value falls back.
