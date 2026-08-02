# Guide screenshots

Captured from a **throwaway demo instance** (a fresh `HOME`, empty config seeded with neutral demo data
— `acme-web` / `acme-api`, `Shell` / `Node REPL` launchers), so no personal session data appears. Retina
(`deviceScaleFactor: 2`), 1440×900 viewport.

| File | Shows |
|---|---|
| `single-view.png` | The single view (chat + GUI panel) |
| `grid-launch-form.png` | An empty grid cell's launcher form (dir / Claude·Codex / worktree / launch commands) |
| `grid-one-cell.png` | One running cell — the two-row header, git chip, `connected` |
| `grid-two-cells.png` | Two parallel terminals |
| `grid-2x2.png` | Four parallel terminals (2×2) |
| `grid-zoom.png` | Expanded cell + filmstrip thumbnails |
| `settings.png` | The Settings modal (theme / sound / PR repos / launch commands / MCP) |
| `config-settings-modal.png` | The Settings modal: Theme, Terminal font size, Directory appearance, **Directory settings** (a directory expanded), Notification sounds |
| `config-dir-settings.png` | One expanded Directory-settings row — values in force with colour swatches, the file they came from, and `Not settings this app reads (a typo?)` listing a deliberately misspelt `badgeColour` and `fontSize2` |
| `config-launcher-chips.png` | An empty cell's launcher showing three settings at once: `cwdPresets` chips (with their directory-colour stripe), `script.json` under OR RUN A SCRIPT, `launchers` under OR LAUNCH |
| `config-custom-themes.png` | The Settings theme picker with four user-defined schemes (Mondrian / Van Gogh (Arles) / Picasso Blue / Matisse) beside the built-in four, with Van Gogh applied |
| `grid-colors.png` | Four projects color-coded via per-dir `.mulmoterminal.json` (Mondrian / Van Gogh / Picasso / Matisse). Real Claude cells in throwaway `/tmp` demo repos on untrusted dirs (so the trust prompt shows, no account/email leaks). |
| `worktree-close-keep.png` | Closing a worktree cell with nothing unsaved — Keep worktree / Remove worktree / Cancel |
| `worktree-close-discard.png` | The same dialog when the worktree has unpushed commits + uncommitted changes — the button becomes `Discard & remove` |

## Not yet captured (need a live Claude/Codex session)

These states need a real agent turn (cost/time) to look right, so they aren't referenced in the guide yet.
Capture from the demo instance while a Claude session runs, then add them:

- Working / needs-attention status colors on a cell.
- The model / context badge (`Opus · ctx 35%`).
- A worktree cell's diff PANEL (the badge itself is in `worktree-close-discard.png` as `+2 ●5`).
- The activity timeline (🕘) modal.
- The estimated-cost block in Settings.
