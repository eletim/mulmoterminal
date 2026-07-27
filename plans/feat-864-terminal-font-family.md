# Configurable terminal font family

Issue: #864 (follows #860 / PR #866, which made `fontSize` configurable)

## The ask

Two things, from the issue and from the user:

1. `fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace"` is hardcoded in the xterm
   constructor (`src/composables/useTerminalConnections.ts`), and no config key can change it.
2. **Put major CJK fonts into that default stack.** Today a Japanese glyph is not named anywhere
   in it, so it falls through to whatever the browser's generic `monospace` resolves to.

## Where the value lives — decided with the user

`fontSize` (#860) went to **localStorage + a Settings stepper**, because a *size* is a per-display
preference: a phone and a desktop viewing one server want different ones.

A *family* is not the same kind of thing. It is per-**machine** (which fonts are installed), it is
long and fiddly to type, and there is no bounded control that fits it — so the user chose
**config files only, no Settings UI**:

| | Global | Per-directory |
|---|---|---|
| file | `~/.mulmoterminal/config.json` → `fontFamily` | `<dir>/.mulmoterminal.json` → `fontFamily` |
| precedence | fallback | wins |
| default | `TERMINAL_FONT_FAMILY_DEFAULT` | — |

`terminalSubmit` is the precedent for the global half — a `config.json` key with no Settings UI,
served by `GET /api/config` and hydrated into a module-level holder by `useAppConfig`. `fontSize`
never needed that half, so this change adds it: `AppConfig.fontFamily` through `emptyConfig` /
`sanitizeAppConfig` / `mergeConfigUpdate` / `toPublicAppConfig`.

One difference from `terminalSubmit`: it is stored as a plain module value because the keydown
handler reads it imperatively and nothing renders it. Hydration here is **async but visible** — a
terminal can mount before `/api/config` resolves — so the holder is a `ref` (like `activeKeymap`),
and `Terminal.vue`'s watcher re-applies the family when it arrives.

## Changing the family changes the cell metrics

Same load-bearing rule #860 established for the size, and for the same reason: a different face has
a different advance width, so `cols`/`rows` change and the **PTY has to be told**. Setting
`term.options.fontFamily` alone reproduces the browser-zoom bug — xterm's grid disagreeing with what
the shell believes the window to be, so the cursor and the wrap points drift.

Rather than a second copy of that logic, `setFontSize` becomes **`setFont(key, { size, family })`**
and `Conn.fontSize` becomes `Conn.font: TerminalFont`. Both fields re-fit, and a change to both at
once now costs one fit instead of two. It also stops `attach()` growing a seventh positional
parameter.

## The default stack

Latin stays first, so an existing install's ASCII rendering is unchanged. What follows is the CJK
block, JP first (a stack that reached `…CJK SC` first would draw kanji with mainland glyph shapes).

```
'JetBrains Mono', 'Fira Code', Menlo, Consolas,
'Noto Sans Mono CJK JP', 'Hiragino Sans', 'BIZ UDGothic', 'MS Gothic', IPAGothic,
'Noto Sans Mono CJK KR', 'Malgun Gothic',
'Noto Sans Mono CJK SC', 'Microsoft YaHei',
'Noto Sans Mono CJK TC', 'Microsoft JhengHei',
monospace
```

Why name them at all, when generic `monospace` already triggers per-glyph fallback? Because the font
the browser picks for that fallback is not required to be em-square, and **xterm reserves exactly two
cells for a fullwidth character**. A face whose fullwidth advance is not exactly twice the Latin one
tears every box-drawing frame — which is most of what Claude Code draws. Every family named above is
em-square.

Two visible changes to be honest about: `Consolas` is new (a Windows box with neither JetBrains Mono
nor Fira Code was falling to Courier New), and CJK text now renders in a named face rather than the
browser's pick.

## Validating a font-family string

`normalizeFontFamily(input: unknown): string | null` in `common/terminalFontFamily.ts` — pure, in
`common/` because the server validates config files with it and the client re-validates what comes
off the wire.

- Splits on `,`, trims, and requires every entry to be a plausible font name: a leading letter/digit,
  then letters (**any script** — `游ゴシック` and `ＭＳ ゴシック` must pass), digits, marks, spaces,
  `.`, `_`, `-`. Quotes are allowed only as a matching pair wrapping a whole entry.
- **Rejects the whole stack** on any bad entry, where `normalizeFontSize` clamps. A size is a
  continuous quantity, so honouring the direction asked for is better than ignoring it; a stack is
  one intent, and silently dropping half of it renders in a font the author never named.
- Caps the length. Rejects CSS syntax (`;{}()<>\/@!`) and control characters — an unbalanced quote
  or a stray `;` invalidates the whole CSS declaration, and xterm's way of reporting that is to
  render in the browser's *proportional* default: the setting reads as having broken the terminal.
- Appends `monospace` when the author named no generic family, for that same reason — a stack of
  three fonts none of which are installed otherwise lands on a proportional face with nothing on
  screen to explain why.

## Files

- **`common/terminalFontFamily.ts`** (new) — default stack, `normalizeFontFamily`.
- **`common/dirChrome.ts`** — `fontFamily: string | null` (both sides type it identically).
- **`server/config/config-schema.ts`** — `dirFontFamilyField` (lenient) + `fontFamily` in
  `writableDirConfigSchema`, so `dir-config.schema.json` rejects garbage at authoring time.
  Found while building it: **`z.toJSONSchema` silently DROPS a `.refine`**, so expressing the exact
  rule there would have vanished from the shipped schema with nothing to show for it. The strict
  field carries `TERMINAL_FONT_FAMILY_SAFE_RE` instead — a `pattern`, which survives — and a spec
  pins that it never rejects what `normalizeFontFamily` accepts. (A JSON Schema `pattern` is
  ECMA-262 without the `u` flag, so it cannot use the `\p{L}` classes the exact rule needs.)
- **`server/config/dir-config.ts`**, **`src/composables/useDirConfig.ts`** — parse / pass through.
- **`server/config/app-config.ts`** — the global key.
- **`src/composables/terminalFontFamily.ts`** (new) — the hydrated global ref.
- **`src/composables/useAppConfig.ts`** — hydrate it in `loadConfig`.
- **`src/composables/useTerminalConnections.ts`** — `TerminalFont`, `setFont`.
- **`src/components/Terminal.vue`** — `dirFontFamily` prop, `effectiveFontFamily()`, one font watcher.
- **`src/App.vue`**, **`src/components/TerminalCell.vue`** — pass the prop.

## Docs

`README.md` (both config tables), `docs/guide/{en,ja}/config.md`, `docs/guide/{en,ja}/features.md`,
`docs/terminal-notes.md`, `server/skills/mulmoterminal-config/SKILL.md`.

## Tests

- `normalizeFontFamily`: single, list, quoted, Japanese/fullwidth names, generic keywords, whitespace
  normalization, generic-tail appending (and not appending when present), empty/blank, non-string,
  over-length, `;` injection, unbalanced quote, braces, control characters.
- `dirFontFamilyField` lenient path + `dirConfigJsonSchema()` carries `fontFamily`.
- `loadDirConfig` / `publicDirConfig` round-trip; garbage → null.
- `sanitizeAppConfig` / `mergeConfigUpdate` / `toPublicAppConfig` carry the global key.
- `useDirConfig` parses it off the wire; the global ref hydrates and falls back.
