// Whether a keystroke should hand the terminal's clipboard work to the BROWSER, decided without
// touching the DOM so the rules are unit-testable on their own (same shape as `enterKeyOverride`
// in terminalSubmit.ts).
//
// The thing to understand before changing any of this: xterm already implements copy and paste.
// It listens for the `copy` and `paste` DOM events on its own element and textarea, writes the
// selection out, and brackets pasted text. Nothing here reads or writes a clipboard — which is
// also why no clipboard PERMISSION is involved, unlike `navigator.clipboard.readText()`.
//
// What is missing is only that the browser never fires those events: xterm's key handling turns
// Ctrl+C into ^C and cancels the keydown, so the platform's copy shortcut never happens. The one
// decision this module makes is when to stand back and let it.
import { actionForKey, type Keymap, type KeymapAction } from "./keymap.js";

// The structural shape of a keydown these rules need; a real KeyboardEvent satisfies it and so
// does a plain test object.
export interface ClipboardKeyEvent {
  type: string;
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

export type ClipboardAction = Extract<KeymapAction, "copy" | "paste">;

// `hasSelection` is the terminal's own answer, passed in rather than read here so this stays
// DOM-free.
//
// Returning an action means ONE thing to the caller: return false from xterm's custom key
// handler. xterm then skips its own translation and — critically — does NOT preventDefault, so
// the browser performs the copy or paste it was always going to, and xterm's own listeners see
// it. Verified in @xterm/xterm 6.0.0:
//
//   if (this._customKeyEventHandler && false === this._customKeyEventHandler(e)) return false;
//
// null means "not ours" — the key goes to the terminal exactly as before.
export function clipboardActionFor(keymap: Keymap, e: ClipboardKeyEvent, hasSelection: boolean): ClipboardAction | null {
  if (e.type !== "keydown") return null;
  // An IME candidate list drives itself with ordinary keys; that keystroke belongs to the
  // composition, never to us.
  if (e.isComposing) return null;
  const action = actionForKey(keymap, e);
  if (action !== "copy" && action !== "paste") return null;
  // Copy only when there is something to copy. This is what keeps Ctrl+C usable as INTERRUPT:
  // with no selection the key is not ours, so the terminal sends ^C exactly as it always did.
  // Deciding up front — rather than copying and undoing it on failure — is why nothing here has
  // to be reversed.
  return action === "copy" && !hasSelection ? null : action;
}

// Copy-on-select: the text a settled selection should put on the clipboard, or null to leave the
// clipboard alone. `lastCopied` is what this terminal wrote last, so an unchanged selection is not
// written twice.
//
// Unlike the rules above, this one ends in a clipboard WRITE — no keystroke happened, so nothing in
// the browser was ever going to copy anything by itself. That is what makes the two skips here
// matter more than they look:
//
//   - Whitespace only. Dragging across empty terminal space selects spaces, and silently replacing
//     the user's clipboard with a run of them is this feature's worst failure. Anyone who really
//     wants indentation still has the `copy` keymap action.
//   - Unchanged text. A second identical write buys nothing and costs a duplicate entry in the OS
//     clipboard history (Win+V), which is the same reason the caller waits for the selection to
//     settle instead of writing on every onSelectionChange.
export function selectionToCopy(enabled: boolean, selection: string, lastCopied: string | null): string | null {
  if (!enabled || selection.trim() === "" || selection === lastCopied) return null;
  return selection;
}
