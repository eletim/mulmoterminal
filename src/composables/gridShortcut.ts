// Which grid action a key event means, decided without touching the DOM so the rules are
// unit-testable on their own (same shape as `enterKeyOverride` in common/terminalSubmit.ts).
//
// Scope for now: moving the zoom between terminals. That is deliberately the only action
// reachable from a key, because the zoomed cell is the ONLY "which terminal is the user on"
// state the grid actually has — an un-zoomed grid has no selection to act on.
export type GridShortcut = "zoom-next" | "zoom-prev";

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

// A Map, not an object literal: `e.key` is attacker-adjacent free text, and a plain object
// would answer `BY_KEY["constructor"]` with a function that then sails past a `?? null`.
const BY_KEY = new Map<string, GridShortcut>([
  ["PageDown", "zoom-next"],
  ["PageUp", "zoom-prev"],
]);

export function gridShortcutFor(e: ShortcutKeyEvent, zoomed: boolean): GridShortcut | null {
  if (e.type !== "keydown" || !zoomed) return null;
  // An IME candidate list uses PageUp/PageDown to page through candidates; that keystroke
  // belongs to the composition, never to us.
  if (e.isComposing) return null;
  // Bare keys only. Shift+PageUp is xterm's own scrollback, and taking it would leave the
  // user unable to scroll back in the very terminal they just zoomed to read.
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return null;
  return BY_KEY.get(e.key) ?? null;
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
