# Directory config for launcher and command cells

Issue: #902 (found while verifying #864 / PR #870 in the browser)

## The bug

`.mulmoterminal.json` reaches **two** of the four components that render a terminal:

| Component | `useDirConfig` | `dir-*` props |
|---|---|---|
| `src/App.vue` (single view) | yes | yes |
| `src/components/TerminalCell.vue` (grid, Claude) | yes | yes |
| `src/components/LauncherCell.vue` (shell / codex / any launcher) | **no** | **no** |
| `src/components/CommandCell.vue` (a `script.json` run) | **no** | **no** |

So a Shell cell opened in a themed directory ignores `theme`, `colors`, `fontSize`, and
`fontFamily` entirely. It predates this work — `git show origin/main:src/components/LauncherCell.vue
| grep -c dir-font-size` was `0` before #870 too, so #860/#866 shipped with the same hole.

Why it went unnoticed: the two cells that *do* work are the ones anyone demoing a directory theme
reaches for. The gap only shows if you open a plain shell in a directory you have themed — and then
it reads as "the setting is broken", not "this cell type is unwired".

## The fix

Call `useDirConfig` in both components and hand the same four terminal props down. `Terminal.vue`
already accepts and applies them, so the change is entirely on the calling side.

- **`LauncherCell.vue`** — `useDirConfig(toRef(props, "cwd"))`.
- **`CommandCell.vue`** — the cwd lives one level in, at `props.command.cwd`, so a getter ref.

## Deliberately NOT in scope

**The name badge and header colours.** `TerminalCell` renders `dirConfig.name` as a badge and tints
its header from `headerColor` / `buttonColor`; these two components have their own, different header
markup (a launcher shows its command label, a command cell its summary panel). Fitting a badge into
them is a design question, not a wiring one, and the terminal-side gap is what makes the feature look
broken. Recorded on the issue rather than guessed at here.

That means after this change a Shell cell adopts the directory's **font and palette** but still shows
no name badge — worth stating plainly so the next person doesn't read it as a half-applied fix.

## Tests

`test/src/components/TerminalCellDirFont.spec.ts` already pins this wiring for `TerminalCell` — the
same shape, one component over. Add the launcher and command equivalents so the hole cannot reopen in
either.
