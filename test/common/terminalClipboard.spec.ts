import { describe, it, expect } from "vitest";
import { clipboardActionFor } from "../../common/terminalClipboard";
import { TERMINAL_SCOPED_ACTIONS, type Keymap } from "../../common/keymap";

const keymap: Keymap = { copy: "Ctrl+c", paste: "Ctrl+v", "zoom-next": "PageDown" };

const key = (k: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }> = {}) => ({
  type: "keydown",
  key: k,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
});

describe("clipboardActionFor", () => {
  it("claims a bound copy only when there is something to copy", () => {
    expect(clipboardActionFor(keymap, key("c", { ctrl: true }), true)).toBe("copy");
  });

  // The whole reason copy is decided up front rather than attempted and undone: a terminal that
  // stopped sending ^C would be broken in a way no clipboard feature is worth.
  it("leaves Ctrl+C alone with no selection, so the terminal still gets ^C", () => {
    expect(clipboardActionFor(keymap, key("c", { ctrl: true }), false)).toBeNull();
  });

  // Paste has no such condition — there is nothing to inspect, and the browser does the work.
  it("claims a bound paste regardless of selection", () => {
    expect(clipboardActionFor(keymap, key("v", { ctrl: true }), false)).toBe("paste");
    expect(clipboardActionFor(keymap, key("v", { ctrl: true }), true)).toBe("paste");
  });

  it("ignores keys bound to something else, and unbound keys", () => {
    expect(clipboardActionFor(keymap, key("PageDown"), true)).toBeNull();
    expect(clipboardActionFor(keymap, key("x", { ctrl: true }), true)).toBeNull();
  });

  // Nothing is bound by default: an unconfigured install must never take a key from the terminal.
  it("claims nothing at all when the user has bound nothing", () => {
    expect(clipboardActionFor({}, key("c", { ctrl: true }), true)).toBeNull();
    expect(clipboardActionFor({}, key("v", { ctrl: true }), true)).toBeNull();
  });

  it("ignores keyup and an IME composition", () => {
    expect(clipboardActionFor(keymap, { ...key("c", { ctrl: true }), type: "keyup" }, true)).toBeNull();
    expect(clipboardActionFor(keymap, { ...key("c", { ctrl: true }), isComposing: true }, true)).toBeNull();
  });

  // A binding is matched exactly as written, so a user on macOS can bind Cmd instead without the
  // module knowing anything about platforms.
  it("matches whatever modifier the binding names", () => {
    const mac: Keymap = { copy: "Meta+c", paste: "Meta+v" };
    expect(clipboardActionFor(mac, key("c", { meta: true }), true)).toBe("copy");
    expect(clipboardActionFor(mac, key("c", { ctrl: true }), true)).toBeNull();
  });

  it("declares both actions terminal-scoped, so the grid handler cannot claim them", () => {
    expect([...TERMINAL_SCOPED_ACTIONS].sort()).toEqual(["copy", "paste"]);
  });
});
