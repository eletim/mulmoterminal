import { KEYMAP_ACTIONS, type KeymapAction } from "../../common/keymap";

// What each bindable action is called in the settings list.
//
// A full Record, not a lookup with a fallback: adding an action to KEYMAP_ACTIONS then fails to
// compile until it is named here, so a new shortcut can't ship invisible to the one screen that
// tells the user it exists.
const LABELS: Record<KeymapAction, string> = {
  "zoom-toggle": "Enlarge / collapse a terminal",
  "zoom-next": "Enlarge the next terminal",
  "zoom-prev": "Enlarge the previous terminal",
  "next-attention": "Jump to a terminal that needs you",
  "terminal-new": "New terminal (at the end)",
  "terminal-new-adjacent": "New terminal next to this one",
  "terminal-close": "Close this terminal",
  // Only acts when the terminal has a selection; with none, the key reaches the shell as it
  // always did — which is what makes Ctrl+C a usable binding here without losing interrupt.
  copy: "Copy the terminal selection",
  paste: "Paste into the terminal",
};

export interface KeymapRow {
  action: KeymapAction;
  label: string;
  // The user's binding, or null when they haven't set one — shown as "Not set" rather than
  // hidden, since an unbound row is how someone discovers the action exists at all.
  binding: string | null;
}

export const keymapRows = (keymap: Partial<Record<KeymapAction, string>>): KeymapRow[] =>
  KEYMAP_ACTIONS.map((action) => ({ action, label: LABELS[action], binding: keymap[action] ?? null }));
