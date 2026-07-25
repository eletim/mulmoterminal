# Terminal notes (developer reference)

Everything the terminal does that isn't obvious from the code, why it's there, and **what to
re-check when a dependency is upgraded**. The terminal has been the source of a long tail of
subtle bugs (selection, scrolling, links, copy/paste, key handling) because it straddles four
layers — each with its own quirks — and a change in any one can silently break another.

> If you touch xterm, an xterm addon, tmux, node-pty, or the Claude Code version, read the
> **[Upgrade regression checklist](#upgrade-regression-checklist)** at the bottom first.

## The stack

```
browser  ── @xterm/xterm (canvas renderer, addons)   src/composables/useTerminalConnections.ts
   │  WebSocket  { type:"input"|"output"|... }        src/components/Terminal.vue
server   ── node-pty  ── tmux (persistence)  ── agent (claude / codex / $SHELL)
              server/session/*.ts               server/infra/tmux.ts
```

- The **browser** runs xterm.js. Its durable runtime (socket + xterm instance) lives in the
  module-singleton manager `useTerminalConnections.ts`, independent of the Vue component, so a
  session survives view switches / unmounts (see the file header).
- The **server** raw-forwards PTY output to the socket (`term.onData → sendFrame({type:"output"})`
  in `server/session/spawn-*.ts`) and writes socket input to the PTY. It is a dumb pipe for live
  I/O — it does **not** re-serialize through the headless emulator, so escape sequences pass
  through byte-for-byte.
- **tmux** wraps every persistent session so it outlives the server process. This is where a lot
  of the surprises come from — see [The tmux passthrough rule](#the-tmux-passthrough-rule).

## Version pins that matter

| Package | Pin | Why it's load-bearing |
|---|---|---|
| `@xterm/xterm` | `^6.0.0` | 6.0 changed the scrollbar (VS Code-style overlay) and internals. The DOM/link/scroll code assumes 6.x. |
| `@xterm/addon-canvas` | `^0.7.0` | ⚠️ **Peers on `@xterm/xterm@^5`** — an xterm-5 renderer running on xterm-6. There is **no stable xterm-6 canvas addon** (even `0.8.0-beta` peers `^5`). Suspected cause of the scrollbar / selection-auto-scroll problems (#782). See [Renderer](#renderer-canvas-vs-dom). |
| `@xterm/addon-web-links` | `^0.12.0` | Linkifies visible `http(s)://` URLs. |
| `@xterm/addon-clipboard` | `^0.2.0` | OSC 52 clipboard write (auto-copy → browser clipboard). |
| `@xterm/addon-fit` | `^0.11.0` | Size the grid to the container. |
| `node-pty` | `^1.1.0` | The PTY. |
| tmux | 3.4+ at runtime | OSC 8 hyperlink forwarding (`terminal-features hyperlinks`) needs 3.4+. Measured on 3.6a. |

## Configured behaviors (and the issues behind them)

### xterm `Terminal` options — `useTerminalConnections.ts`

- `macOptionIsMeta: true` (#265/#266) — macOS Option acts as Meta so Claude's Alt bindings reach
  the PTY (Alt+Enter newline, Alt+B/F word nav). Cost: Option dead-key accents don't work.
- `macOptionClickForcesSelection: true` (#729) — on macOS, **text selection requires Option+drag**
  (mouse-tracking apps otherwise capture the drag). Without this a Mac can't select at all.
- `allowProposedApi: true` — `term.parser` is proposed API and throws without it (used by the
  mouse-tracking guard).
- `linkHandler` (#783/#785) — opens OSC 8 hyperlinks (e.g. Claude's statusline `PR #123`) on
  click, restricted to `http(s)://` (a program could emit a `javascript:` link). Without it xterm
  falls back to a `confirm()` dialog. **Necessary but not sufficient** — see the tmux rule.

### Submit vs newline — `terminalSubmit` (#772/#780)

Whether Enter submits or inserts a newline is decided by Claude Code from the received **bytes**,
and that mapping is environment-dependent. `terminalSubmit` (`"cr"` default / `"esc-cr"`) picks
which byte submits; it drives the browser key handler **and** the phone remote-view submit, scoped
to Claude sessions only (shell/codex keep plain CR). See the [config guide](guide/en/config.html#terminal-submit).
The `esc-cr` bare-Enter interception is guarded on `isComposing` so IME confirm isn't eaten.

### Links — three independent mechanisms

| Kind | Where | Recognizes |
|---|---|---|
| Local file path (#778) | `terminalFilePathLinkProvider.ts` (`registerLinkProvider`) | a token with a `/` and a file extension → opens `/api/files/raw` preview, scoped to the session cwd |
| OSC 8 hyperlink (#783/#785) | `linkHandler` + xterm core `OscLinkService` | arbitrary text → URL (Claude statusline `PR #NNNN`) — **requires the tmux `hyperlinks` feature** |
| Plain URL | `WebLinksAddon` | visible `http(s)://` URLs |

### Mouse tracking & selection — `guardMouseTracking` (#729/#737)

- SET of a mouse-tracking mode (`CSI ? … h`, e.g. 1000/1002/1003/1006) is **swallowed** so a drag
  stays a text selection instead of the app's coordinate reports landing in the prompt (#729).
- In the alternate buffer, xterm's fallback turns the wheel into ↑/↓ arrows — which a TUI binds to
  input history, so scrolling spun the prompt. The wheel handler synthesizes the SGR report the
  app asked for instead (#737). The swallowed modes are per-session and cleared on `term.reset()`.

### Renderer (canvas vs DOM)

The **canvas renderer** (`@xterm/addon-canvas`, added to fix CJK glyph drift — long Japanese lines
spilling off the right edge with the DOM renderer) draws each glyph in a fixed cell. But the addon
is xterm-5-era on xterm-6 (see the version table), and is the suspected cause of #782. See the
CAVEAT comment at the `loadAddon(new CanvasAddon())` site. **Debugging note:** the canvas renderer
paints to `<canvas>`, so terminal text and link decorations are **not in the DOM** — headless
inspection (`.xterm-rows`, `elementFromPoint`) sees nothing. To debug links/selection headlessly,
force the DOM renderer or observe effects (`window.open`, buffer state) instead of reading the canvas.

### Live output, replay, and query stripping

- Live output is raw-forwarded. On **reattach**, the server replays a bounded tail
  (`entry.buffer`) through `stripTerminalQueries` (`terminal-replay.ts`) so xterm doesn't re-answer
  device queries (a DA reply would surface as `0;276;0c` in the prompt).
- The replay buffer tail is sliced carefully so a cut never lands inside an escape sequence (#434),
  and is sized (~1 MiB) so scrollback survives a reattach (#776).

## The tmux passthrough rule

**This is the single most important gotcha.** tmux only forwards a program's advanced terminal
sequences to the outer terminal (our xterm) when told the outer terminal supports them. Two cases
have already bitten us, with the **same shape**:

| Feature | What breaks without it | Fix in `server/infra/tmux.ts` | Issue |
|---|---|---|---|
| OSC 52 clipboard | Claude's auto-copy never reaches the browser clipboard | `terminal-overrides` `Ms` capability | #206 |
| OSC 8 hyperlinks | Claude statusline `PR #NNNN` (and any OSC 8 link) isn't clickable | `set -as terminal-features '*:hyperlinks'` | #783 |

**If a future Claude Code / codex version starts emitting a new OSC/terminal feature (sixel,
notifications, kitty keyboard, OSC 7 cwd, …) and it "doesn't work through the app but works in a
bare terminal", suspect tmux stripping it first** — add the corresponding `terminal-features` flag
or `terminal-overrides` capability. The isolation test: write the sequence **directly to xterm**
(bypassing tmux); if it works there but not through a session, tmux is the culprit.

## Known issues / open items

- **#782 — scrollbar not shown / selection doesn't auto-scroll** (open). Likely the xterm-5 canvas
  addon on xterm-6, but the scrollbar (auto-hide VS Code overlay) reproduced on the DOM renderer
  too, so it may be two roots. Fix is a renderer decision (WebGL vs DOM), which needs on-device QA
  (CJK drift, scrollbar, selection). See #782 for the full analysis.
- **Selection & copy/paste** — several sharp edges:
  - macOS: selection is **Option+drag** (`macOptionClickForcesSelection`), not plain drag.
  - You can only select what's on screen: a Claude/Codex TUI runs in the **alternate buffer**,
    which has no xterm scrollback, and the normal-buffer selection **auto-scroll is broken** (#782)
    — so copying more than the visible screen isn't possible today.
  - Copy (auto): Claude's OSC 52 auto-copy works only via the tmux `Ms` override + `set-clipboard
    on` (#206). Paste uses the browser's native Cmd+V into xterm (there is no app paste button).
- **Phone submit** — the submit byte is env-dependent (`terminalSubmit`, #445/#772); the sanitizer
  strips control bytes so phone input is single-line.

## Upgrade regression checklist

When bumping **xterm / an xterm addon / tmux / node-pty / the Claude Code version**, re-verify the
matrix below. Most of these **cannot be caught by unit tests** (they need a real terminal + a human
looking) — flag them for QA on the release.

| Area | Check in code | Needs user QA |
|---|---|---|
| Renderer / CJK | canvas addon still loads; `@xterm/addon-canvas` peer vs `@xterm/xterm` major (mismatch = red flag) | long Japanese line doesn't drift off the right edge |
| Scrollbar / selection | — (no unit coverage) | scrollbar visible + synced; Option+drag selects; selection auto-scrolls past the visible screen (#782) |
| OSC 8 links | tmux `terminal-features '*:hyperlinks'` present; xterm `linkHandler` set | click Claude statusline `PR #NNNN` → opens the PR (no confirm dialog) |
| OSC 52 clipboard | tmux `Ms` override + `set-clipboard on` present (`planMsOverride`) | Claude auto-copy reaches the browser clipboard |
| File-path links | `registerFilePathLinks` order vs WebLinks; `/api/files/raw` cwd containment | click a generated file path → previews the file |
| Enter / newline | `terminalSubmit` mapping + `isComposing` guard; `macOptionIsMeta` | Enter submits, Shift+Enter newlines; IME confirm not eaten; both `cr` and `esc-cr` |
| Mouse / wheel | `guardMouseTracking` swallow set (1000/1002/1003/1006); wheel→SGR in alt buffer | wheel scrolls transcript (not prompt history); drag selects, doesn't emit mouse reports |
| Reattach | `stripTerminalQueries` patterns; replay buffer size | reattaching a session doesn't leak `0;276;0c`-style junk; scrollback survives |

**Fast isolation techniques** (learned the hard way):
- A terminal behavior that works on a **direct `term.write()`** but fails through a live session ⇒
  the **transport (usually tmux)** is stripping/transforming it, not xterm.
- The **canvas renderer hides text from the DOM** — force the DOM renderer (or observe `window.open`
  / buffer state) to debug links/selection headlessly.
- A "works in a bare terminal, not in the app" report ⇒ check the tmux `terminal-features` /
  `terminal-overrides` first.

## Related

`docs/spawn-architecture.md` (session lifecycle), `docs/gui-protocol-spike.md`,
`src/composables/useTerminalConnections.ts`, `server/infra/tmux.ts`, `server/session/*.ts`.
Issues: #206, #263/#264/#293, #265/#266, #434, #445, #572, #729, #737, #772/#780, #776, #778, #782, #783/#785.
