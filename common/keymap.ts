// The user-defined keyboard shortcuts, in `~/.mulmoterminal/config.json` under `keymap`.
//
// There are NO defaults: an absent or empty `keymap` means the shortcuts are OFF. Every
// binding is something the user opted into, because any key this claims is a key the
// terminal underneath stops receiving — that trade is the user's to make, not ours.
//
// The server sanitizes and persists it; the browser matches keydowns against it. One
// definition here so the accepted syntax can't drift between the two.
//
//   "keymap": { "zoom-next": "PageDown", "zoom-prev": "Shift+PageUp" }

// Actions a key can be bound to. Adding one here is all it takes for the config to accept it.
export const KEYMAP_ACTIONS = ["zoom-next", "zoom-prev", "terminal-new", "terminal-new-adjacent", "terminal-close"] as const;
export type KeymapAction = (typeof KEYMAP_ACTIONS)[number];

export const isKeymapAction = (value: unknown): value is KeymapAction => typeof value === "string" && (KEYMAP_ACTIONS as readonly string[]).includes(value);

// action -> binding string. Absent action = unbound = that shortcut does nothing.
export type Keymap = Partial<Record<KeymapAction, string>>;

// A parsed binding. `key` is matched against `KeyboardEvent.key` exactly as the browser
// reports it, so it is case-sensitive for printable characters ("a" and "A" differ, the
// latter implying Shift).
export interface KeyBinding {
  key: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

// Modifier spellings accepted in a binding string, mapped to the flag they set. "Cmd",
// "Command" and "Meta" are the same modifier; "Option" is macOS's name for Alt.
const MODIFIERS: Record<string, keyof Omit<KeyBinding, "key">> = {
  shift: "shift",
  alt: "alt",
  option: "alt",
  ctrl: "ctrl",
  control: "ctrl",
  meta: "meta",
  cmd: "meta",
  command: "meta",
};

// Parse "Shift+PageUp" into its parts, or null when the string is malformed (empty, no
// key left after the modifiers, an unknown modifier, or a duplicate one). Callers treat
// null as "unbound" rather than throwing: a typo in a hand-edited config must cost the
// user that one shortcut, never the app.
export function parseKeyBinding(input: string): KeyBinding | null {
  const parts = input.split("+").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part === "")) return null;
  const key = parts[parts.length - 1];
  const binding: KeyBinding = { key, shift: false, alt: false, ctrl: false, meta: false };
  for (const part of parts.slice(0, -1)) {
    const flag = MODIFIERS[part.toLowerCase()];
    if (!flag || binding[flag]) return null; // unknown, or named twice
    binding[flag] = true;
  }
  // A lone modifier ("Shift") binds nothing usable.
  return MODIFIERS[key.toLowerCase()] ? null : binding;
}

// The structural shape of a keydown a binding is matched against. A real KeyboardEvent
// satisfies it, and so does a plain test object — no DOM dependency.
export interface KeymapKeyEvent {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

// Every modifier must match exactly, so a binding on "PageDown" does NOT fire for
// Shift+PageDown — that keystroke stays with the terminal (xterm's scrollback) unless the
// user binds it too.
export const matchesBinding = (binding: KeyBinding, e: KeymapKeyEvent): boolean =>
  e.key === binding.key && e.shiftKey === binding.shift && e.altKey === binding.alt && e.ctrlKey === binding.ctrl && e.metaKey === binding.meta;

// The action this keydown is bound to, or null. Bindings that fail to parse are skipped.
export function actionForKey(keymap: Keymap, e: KeymapKeyEvent): KeymapAction | null {
  for (const action of KEYMAP_ACTIONS) {
    const raw = keymap[action];
    if (raw === undefined) continue;
    const binding = parseKeyBinding(raw);
    if (binding && matchesBinding(binding, e)) return action;
  }
  return null;
}

// What is wrong with one `keymap` entry. `fatal` separates a typo the user clearly meant to
// work (a binding we cannot parse — the shortcut would silently never fire) from an action
// name we simply do not know, which is what a config written for a NEWER version looks like
// and must stay loadable.
export interface KeymapProblem {
  action: string;
  binding: unknown;
  reason: string;
  fatal: boolean;
}

// Report everything wrong with a `keymap`, for a caller that wants to tell the user instead
// of quietly dropping entries. Pure: the caller decides whether to warn, throw, or exit.
export function validateKeymap(input: unknown): KeymapProblem[] {
  if (input === undefined || input === null) return [];
  if (typeof input !== "object" || Array.isArray(input)) {
    return [{ action: "keymap", binding: input, reason: "`keymap` must be an object of action -> key binding", fatal: true }];
  }
  return Object.entries(input as Record<string, unknown>).flatMap(([action, binding]): KeymapProblem[] => {
    if (!isKeymapAction(action)) {
      return [{ action, binding, reason: `unknown action (known: ${KEYMAP_ACTIONS.join(", ")})`, fatal: false }];
    }
    if (typeof binding !== "string") return [{ action, binding, reason: "binding must be a string", fatal: true }];
    if (parseKeyBinding(binding) === null) {
      return [{ action, binding, reason: 'unparseable key binding — expected e.g. "PageDown" or "Shift+PageUp"', fatal: true }];
    }
    return [];
  });
}

// Keep only known actions bound to a parseable, non-empty string. Unknown keys and
// malformed bindings are dropped rather than rejecting the whole map, matching how the
// rest of the config treats one bad entry.
export function sanitizeKeymap(input: unknown): Keymap {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const entries = Object.entries(input as Record<string, unknown>).filter(
    (entry): entry is [KeymapAction, string] => isKeymapAction(entry[0]) && typeof entry[1] === "string" && parseKeyBinding(entry[1]) !== null,
  );
  return Object.fromEntries(entries);
}
