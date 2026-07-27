# Keyboard copy / paste in the terminal

Issue: #900

## What the gap actually is

xterm 6.0 **already implements copy and paste.** It listens for the `copy` and `paste` DOM events
on its own element and textarea, writes the selection out, and brackets pasted text. Reading its
source rather than assuming was the thing that changed this design:

```js
addDisposableListener(this.element, "copy", (e) => this.hasSelection() && copyHandler(e, this._selectionService))
addDisposableListener(this.textarea, "paste", handler)   // and on this.element too
```

Nothing is missing except that the browser never fires those events: xterm's key handling turns
Ctrl+C into `^C` and cancels the keydown, so the platform's copy shortcut never happens.

So this is not "implement copy/paste". It is **"decide when to stand back and let the browser do
the copy/paste it was always going to"**.

## Where the decision goes

`attachCustomKeyEventHandler` — the hook this file already uses for the Enter mapping. Verified in
`@xterm/xterm` 6.0.0:

```js
if (this._customKeyEventHandler && false === this._customKeyEventHandler(e)) return false;
```

It returns early **without** `preventDefault()`. Returning `false` therefore leaves the browser's
default action intact, the native shortcut runs, and xterm's own listeners do the work.

That removes every moving part the obvious implementation needs: no `window` capture listener, no
`stopImmediatePropagation`, no juggling of `preventDefault`. It also means **no clipboard API is
called at all** — so no clipboard READ permission, which `navigator.clipboard.readText()` would
have required.

## The two rules

| | condition | result |
|---|---|---|
| `copy` | bound key **and** `term.hasSelection()` | return false — the browser copies |
| | no selection | not ours; the terminal sends `^C` exactly as before |
| `paste` | bound key | return false — the browser pastes |

`^C` survives because of the CONDITION, decided up front. Nothing is attempted and undone, so
nothing has to be reversed when it fails.

## One config surface, two dispatchers

The bindings live in the existing `keymap` block — a second place to bind a key would be worse for
the user than an internal split. But the grid's handler cannot dispatch them:

- It ends every match with `preventDefault()` (`GridView.vue`). For `paste` that cancels the very
  default action that inserts the text.
- `copy` must fall through when there is no selection; a handler that already swallowed the key
  cannot change its mind.

So `TERMINAL_SCOPED_ACTIONS` marks them and `gridShortcutFor` refuses them outright. The split is
one line in each place and named where a reader meets it.

## Nothing bound by default

Consistent with `keymap`'s existing stance. `copy` on `Ctrl+C` would in fact be safe — the
condition means it costs nothing when there is no selection — but `paste` on `Ctrl+V` genuinely
takes that key from TUIs that use it, and binding one but not the other is a rule nobody can
remember. Both opt-in, with the recommendation documented.

## Deliberately NOT here

**`copyOnSelect`.** It is a separate mechanism (`onSelectionChange`, no key handling) with its own
surprise — the clipboard changing when the user only meant to highlight. It deserves its own issue
rather than riding along.

## Not verified in a browser

No browser automation in this session. The rules are unit-tested and the xterm behaviour was read
from its source, but the end-to-end needs a manual check — **and `^C` with no selection is the one
to check first**, because breaking interrupt would be far worse than not having copy.
