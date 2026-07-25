import { sanitizeKeymap, type Keymap } from "../../common/keymap";

// The active keyboard shortcut map, hydrated once from /api/config and read by the grid's
// key handler at keydown time. A plain module value, not a ref, for the same reasons as
// terminalSubmitMode: the handler reads it imperatively, one map applies app-wide, and
// keeping it here lets useAppConfig set it without importing the grid.
//
// Starts EMPTY, and stays empty when config.json has no `keymap` — the shortcuts are
// opt-in, so an unconfigured install must never claim a key from the terminal.
let current: Keymap = {};

export const getActiveKeymap = (): Keymap => current;
export const setActiveKeymap = (keymap: unknown): void => {
  current = sanitizeKeymap(keymap);
};
