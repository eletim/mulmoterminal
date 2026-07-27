// Which grid action a key event means, decided without touching the DOM so the rules are
// unit-testable on their own (same shape as `enterKeyOverride` in common/terminalSubmit.ts).
//
// The key->action mapping itself is the user's, from `keymap` in config.json — see
// common/keymap.ts. Nothing is bound by default, so an unconfigured install never takes a
// key away from the terminal.
//
// Scope for now: moving the zoom between terminals. That is deliberately the only action a
// key can reach, because the zoomed cell is the ONLY "which terminal is the user on" state
// the grid actually has — an un-zoomed grid has no selection to act on.
import { actionForKey, TERMINAL_SCOPED_ACTIONS, type Keymap, type KeymapAction } from "../../common/keymap";

export type GridShortcut = KeymapAction;

// The structural shape of a keydown these rules need. A real KeyboardEvent satisfies it, and
// so does a plain test object — no DOM dependency.
export interface ShortcutKeyEvent {
  type: string;
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

// Actions that act ON a terminal, and so need one the grid can name. The zoomed cell is the
// only such state the grid has — un-zoomed there is no "current terminal", so these do
// nothing rather than guessing which cell the user meant. `terminal-new` is exempt: appending
// a cell needs no subject.
//
// `zoom-toggle` and `next-attention` are exempt alongside `terminal-new`: they choose the cell
// to enlarge themselves, which is exactly what makes them the keyboard's way INTO the zoom.
const NEEDS_A_CURRENT_TERMINAL: readonly GridShortcut[] = ["zoom-next", "zoom-prev", "terminal-new-adjacent", "terminal-close"];

export function gridShortcutFor(keymap: Keymap, e: ShortcutKeyEvent, zoomed: boolean): GridShortcut | null {
  if (e.type !== "keydown") return null;
  // An IME candidate list uses keys like PageUp/PageDown to page through candidates; that
  // keystroke belongs to the composition, never to us.
  if (e.isComposing) return null;
  const action = actionForKey(keymap, e);
  if (action === null) return null;
  // Terminal-scoped actions are decided inside the terminal (common/terminalClipboard.ts) and
  // must never reach this handler, which ends every match with preventDefault() — fatal for
  // `paste`, whose whole mechanism is the browser's own default action.
  if (TERMINAL_SCOPED_ACTIONS.includes(action)) return null;
  return zoomed || !NEEDS_A_CURRENT_TERMINAL.includes(action) ? action : null;
}

// Whether the keystroke is being typed into a form field and so must be left alone.
//
// The trap: xterm's own input surface IS a <textarea> (class `xterm-helper-textarea`), so a
// plain "ignore INPUT/TEXTAREA/SELECT" rule would ignore the terminal itself — the one place
// the shortcut has to work.
const EDITABLE_TAGS = ["INPUT", "TEXTAREA", "SELECT"];
const XTERM_INPUT_CLASS = "xterm-helper-textarea";

export function isEditableTarget(tagName: string, classNames: readonly string[]): boolean {
  if (classNames.includes(XTERM_INPUT_CLASS)) return false;
  return EDITABLE_TAGS.includes(tagName.toUpperCase());
}
