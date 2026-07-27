# Copy-on-select in the terminal

Issue: #900 (the half left open after #933 shipped the `copy` / `paste` keymap actions)

## The mechanism, and why it is not #933's

The entry point is `term.onSelectionChange` rather than `attachCustomKeyEventHandler`. That is the
smaller half of the difference. The larger half is what happens after:

| | #933 | copy-on-select |
|---|---|---|
| trigger | the user pressed a copy key | the selection changed |
| what the browser has been asked for | a copy | nothing |
| who writes the clipboard | **xterm**, from its own `copy` listener | **us** |

Issue #933 called no clipboard API at all — it returned `false` and stood back while the browser did the
copy the keystroke had already requested. There is no keystroke here, so nothing is going to happen
unless this app writes the clipboard itself. **That makes it the first place in the app that does.**
Every constraint below follows from it.

## Constraint 1: `navigator.clipboard` does not exist over plain `http://`

The Clipboard API is secure-context-gated, so anyone reaching this app at `http://192.168.x.x:PORT`
— a normal way to use it from a second machine — has `navigator.clipboard === undefined`. The
existing OSC 52 provider swallows the same hole in a `catch`.

Fallback: focus `.xterm-helper-textarea` and call `document.execCommand("copy")`, which fires
xterm's own `copy` listener and lets it write the current selection. Works in insecure contexts,
and is the route the reporter's own userscript used.

That fallback is usable only BECAUSE the text wanted is exactly the terminal's live selection. It
is not a general "copy this string" primitive and must not become one.

## Constraint 2: `onSelectionChange` fires throughout the drag

Verified in `@xterm/xterm` 6.0.0 — the selection service compares previous and current start/end
coordinates and fires whenever they differ:

```js
e[1]===this._oldSelectionStart[1] && t[0]===this._oldSelectionEnd[0] && ... || this._fireOnSelectionChange(e,t,i)
```

One drag across twenty cells is up to twenty events. Writing on each is not merely wasteful: on
Windows with clipboard history on (Win+V), **every intermediate write becomes a history entry**, so
one drag buries the user's history under partial selections.

So the write waits for the selection to SETTLE — each event restarts the timer, only the last one
writes. Same shape as the reporter's `setTimeout(…, 0)` fix for reading the selection too early
after `mouseup`, arrived at for a different reason.

## Constraint 3: a whitespace-only selection must not clobber the clipboard

Dragging across empty terminal space selects spaces. Silently replacing the user's clipboard with a
run of them is this feature's worst failure mode. Skipped — the `copy` keymap action remains for
anyone who genuinely wants to copy indentation. Re-copying identical text is skipped for the same
reason: a duplicate clipboard-history entry with nothing to show for it.

That last skip has to expire, though. Between two drags the user may have copied something else, so
re-selecting the same text is a fresh intent, not a repeat — remembering it forever would leave them
holding the wrong thing with no sign of it. **A cleared selection retires the remembered text**, and
that has to be observed per EVENT rather than at settle: a click that clears and the drag that
follows can both land inside one settle window, and by the time the timer runs only the new
selection is visible.

## Config surface: `copyOnSelect`, not a `keymap` value

`copyOnSelect: boolean`, default `false`, config.json only — matching `prWorkdirFooter` /
`worklogEnabled` / `fontFamily`, which have no Settings UI either.

Folding it into the existing `keymap` block instead (`{ "keymap": { "copy": "select" } }`) was
considered and rejected. Every `keymap` value is currently a KEY SPELLING that `parseKeyBinding`
parses as one, so `"select"` would be a special case inside it — and it would leave no way to have
both a key and the selection copy, since one action holds one value.

## Shape

| Where | What |
|---|---|
| `common/terminalClipboard.ts` | `selectionToCopy(enabled, selection, lastCopied)` — the whole decision, pure, unit-tested. Returns the text to write, or `null` to leave the clipboard alone |
| `server/config/app-config.ts` | `copyOnSelect` + `sanitizeCopyOnSelect`, through all four places (`emptyConfig`, `sanitizeAppConfig`, `mergeConfigUpdate`, `toPublicAppConfig`) |
| `src/composables/copyOnSelect.ts` | Module-level flag hydrated from `/api/config`, same shape as `terminalSubmitMode.ts` |
| `src/composables/useTerminalConnections.ts` | Subscribe `term.onSelectionChange` in `buildTerminal`, settle, write |

`buildTerminal` rather than `wireTerminalToConn`: this needs nothing from the connection, and a
rebuilt terminal (#846) gets it either way.

## Docs

`docs/guide/{en,ja}/config.md` (settings table + its own section), plus the terminal-behaviour docs
named at the top of `useTerminalConnections.ts` — README.md and `docs/guide/{en,ja}/features.md` —
since selection behaviour is what they describe.

## Verification

Unit tests cover the decision and the config plumbing. Whether a drag actually lands on the system
clipboard, in both a secure and an insecure context, needs a real browser; this session has none, so
it ships unverified on that point — same as #933.
