import { describe, it, expect } from "vitest";
import { actionForKey, matchesBinding, parseKeyBinding, sanitizeKeymap, validateKeymap, type KeymapKeyEvent } from "../../common/keymap.js";

const ev = (over: Partial<KeymapKeyEvent> = {}): KeymapKeyEvent => ({
  key: "PageDown",
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

describe("parseKeyBinding", () => {
  it("parses a bare key", () => {
    expect(parseKeyBinding("PageDown")).toEqual({ key: "PageDown", shift: false, alt: false, ctrl: false, meta: false });
  });

  it("parses modifiers, and accepts the macOS spellings", () => {
    expect(parseKeyBinding("Shift+PageUp")?.shift).toBe(true);
    expect(parseKeyBinding("Cmd+k")?.meta).toBe(true);
    expect(parseKeyBinding("Command+k")?.meta).toBe(true);
    expect(parseKeyBinding("Meta+k")?.meta).toBe(true);
    expect(parseKeyBinding("Option+k")?.alt).toBe(true);
    expect(parseKeyBinding("Control+k")?.ctrl).toBe(true);
  });

  it("is case-insensitive about modifier names but NOT about the key", () => {
    expect(parseKeyBinding("shift+ALT+x")).toEqual({ key: "x", shift: true, alt: true, ctrl: false, meta: false });
    expect(parseKeyBinding("X")?.key).toBe("X"); // KeyboardEvent.key distinguishes these
  });

  it("tolerates whitespace around the parts", () => {
    expect(parseKeyBinding(" Shift + PageUp ")).toEqual({ key: "PageUp", shift: true, alt: false, ctrl: false, meta: false });
  });

  it("rejects malformed bindings rather than guessing", () => {
    expect(parseKeyBinding("")).toBeNull();
    expect(parseKeyBinding("+")).toBeNull();
    expect(parseKeyBinding("Shift+")).toBeNull();
    expect(parseKeyBinding("+PageUp")).toBeNull();
    expect(parseKeyBinding("Hyper+x")).toBeNull(); // unknown modifier
    expect(parseKeyBinding("Shift+Shift+x")).toBeNull(); // named twice
  });

  it("rejects a lone modifier — it binds nothing usable", () => {
    expect(parseKeyBinding("Shift")).toBeNull();
    expect(parseKeyBinding("Ctrl+Alt")).toBeNull();
  });
});

// parseKeyBinding returns null for malformed input; these fixtures are known-good, and
// failing loudly here beats a non-null assertion silently masking a parser regression.
const binding = (input: string) => {
  const parsed = parseKeyBinding(input);
  if (!parsed) throw new Error(`test fixture is not a parseable binding: ${input}`);
  return parsed;
};

describe("matchesBinding", () => {
  it("requires every modifier to match exactly", () => {
    const bare = binding("PageDown");
    expect(matchesBinding(bare, ev())).toBe(true);
    // Shift+PageDown must stay with the terminal unless the user bound it too.
    expect(matchesBinding(bare, ev({ shiftKey: true }))).toBe(false);
    expect(matchesBinding(bare, ev({ ctrlKey: true }))).toBe(false);
    expect(matchesBinding(bare, ev({ altKey: true }))).toBe(false);
    expect(matchesBinding(bare, ev({ metaKey: true }))).toBe(false);
  });

  it("matches a modified binding only with that modifier held", () => {
    const shifted = binding("Shift+PageUp");
    expect(matchesBinding(shifted, ev({ key: "PageUp", shiftKey: true }))).toBe(true);
    expect(matchesBinding(shifted, ev({ key: "PageUp" }))).toBe(false);
  });
});

describe("actionForKey", () => {
  const keymap = { "zoom-next": "PageDown", "zoom-prev": "PageUp" };

  it("resolves bound keys", () => {
    expect(actionForKey(keymap, ev({ key: "PageDown" }))).toBe("zoom-next");
    expect(actionForKey(keymap, ev({ key: "PageUp" }))).toBe("zoom-prev");
  });

  it("returns null for an empty keymap — the opt-in default", () => {
    expect(actionForKey({}, ev({ key: "PageDown" }))).toBeNull();
  });

  it("returns null for an unbound key", () => {
    expect(actionForKey(keymap, ev({ key: "Home" }))).toBeNull();
  });

  it("skips a malformed binding instead of throwing", () => {
    expect(actionForKey({ "zoom-next": "Hyper+PageDown" }, ev({ key: "PageDown" }))).toBeNull();
  });

  it("does not read through the prototype chain", () => {
    expect(actionForKey(keymap, ev({ key: "constructor" }))).toBeNull();
    expect(actionForKey(keymap, ev({ key: "toString" }))).toBeNull();
  });
});

describe("validateKeymap", () => {
  const warnings = (input: unknown) => validateKeymap(input).filter((p) => !p.fatal);
  const errors = (input: unknown) => validateKeymap(input).filter((p) => p.fatal);

  it("WARNS when two actions claim the same keystroke — only the first would ever fire", () => {
    const input = { "zoom-next": "PageDown", "terminal-close": "PageDown" };
    expect(errors(input)).toEqual([]);
    expect(warnings(input).map((w) => w.action)).toEqual(["terminal-close"]);
    expect(warnings(input)[0].reason).toContain("zoom-next");
  });

  it("names the winner by DISPATCH order, not the order in the config file", () => {
    // actionForKey scans KEYMAP_ACTIONS, so zoom-next wins however the file is written.
    const listedLast = { "terminal-close": "PageDown", "zoom-next": "PageDown" };
    expect(warnings(listedLast).map((w) => w.action)).toEqual(["terminal-close"]);
    expect(warnings(listedLast)[0].reason).toContain("zoom-next");
    // ...and the runtime really does resolve it that way.
    expect(actionForKey(listedLast, ev({ key: "PageDown" }))).toBe("zoom-next");
  });

  it("warns about every loser when three actions share one keystroke", () => {
    const input = { "terminal-close": "F5", "terminal-new": "F5", "zoom-prev": "F5" };
    expect(
      warnings(input)
        .map((w) => w.action)
        .sort(),
    ).toEqual(["terminal-close", "terminal-new"]);
    expect(actionForKey(input, ev({ key: "F5" }))).toBe("zoom-prev");
  });

  it("compares duplicates as PARSED keystrokes, not raw strings", () => {
    // The same keystroke spelled differently — modifier names are case-insensitive.
    expect(warnings({ "zoom-next": "Shift+PageUp", "zoom-prev": "shift+PageUp" })).toHaveLength(1);
  });

  it("does NOT call different keystrokes duplicates", () => {
    expect(validateKeymap({ "zoom-next": "PageDown", "zoom-prev": "Shift+PageDown" })).toEqual([]);
    // KeyboardEvent.key is case-sensitive for printable characters.
    expect(validateKeymap({ "zoom-next": "a", "zoom-prev": "A" })).toEqual([]);
  });

  it("a malformed binding never claims a keystroke, so it can't cause a false duplicate", () => {
    const input = { "zoom-next": "Hyper+PageDown", "zoom-prev": "PageDown" };
    expect(errors(input)).toHaveLength(1);
    expect(warnings(input)).toEqual([]);
  });
});

describe("sanitizeKeymap", () => {
  it("keeps known actions with parseable bindings", () => {
    expect(sanitizeKeymap({ "zoom-next": "PageDown", "zoom-prev": "Shift+PageUp" })).toEqual({
      "zoom-next": "PageDown",
      "zoom-prev": "Shift+PageUp",
    });
  });

  it("drops unknown actions", () => {
    expect(sanitizeKeymap({ "zoom-next": "PageDown", "launch-rockets": "F1" })).toEqual({ "zoom-next": "PageDown" });
  });

  it("drops malformed bindings but keeps the rest", () => {
    expect(sanitizeKeymap({ "zoom-next": "PageDown", "zoom-prev": "Shift+" })).toEqual({ "zoom-next": "PageDown" });
  });

  it("drops non-string values", () => {
    expect(sanitizeKeymap({ "zoom-next": 42, "zoom-prev": null })).toEqual({});
  });

  it("returns an empty map for anything that isn't a plain object", () => {
    expect(sanitizeKeymap(undefined)).toEqual({});
    expect(sanitizeKeymap(null)).toEqual({});
    expect(sanitizeKeymap("PageDown")).toEqual({});
    expect(sanitizeKeymap([])).toEqual({});
    expect(sanitizeKeymap(0)).toEqual({});
  });
});
