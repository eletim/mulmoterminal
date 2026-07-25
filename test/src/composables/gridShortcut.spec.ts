import { describe, it, expect } from "vitest";
import { gridShortcutFor, isEditableTarget, type ShortcutKeyEvent } from "../../../src/composables/gridShortcut.js";

const key = (over: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  type: "keydown",
  key: "PageDown",
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

describe("gridShortcutFor", () => {
  it("maps bare PageDown/PageUp to next/prev while zoomed", () => {
    expect(gridShortcutFor(key({ key: "PageDown" }), true)).toBe("zoom-next");
    expect(gridShortcutFor(key({ key: "PageUp" }), true)).toBe("zoom-prev");
  });

  it("does nothing when nothing is zoomed — an un-zoomed grid has no selected terminal", () => {
    expect(gridShortcutFor(key({ key: "PageDown" }), false)).toBeNull();
    expect(gridShortcutFor(key({ key: "PageUp" }), false)).toBeNull();
  });

  it("leaves Shift+PageUp alone so xterm's scrollback still works", () => {
    expect(gridShortcutFor(key({ key: "PageUp", shiftKey: true }), true)).toBeNull();
    expect(gridShortcutFor(key({ key: "PageDown", shiftKey: true }), true)).toBeNull();
  });

  it("leaves every other modifier combination alone", () => {
    expect(gridShortcutFor(key({ altKey: true }), true)).toBeNull();
    expect(gridShortcutFor(key({ ctrlKey: true }), true)).toBeNull();
    expect(gridShortcutFor(key({ metaKey: true }), true)).toBeNull();
    expect(gridShortcutFor(key({ ctrlKey: true, shiftKey: true }), true)).toBeNull();
  });

  it("ignores anything that isn't a keydown", () => {
    expect(gridShortcutFor(key({ type: "keyup" }), true)).toBeNull();
    expect(gridShortcutFor(key({ type: "keypress" }), true)).toBeNull();
  });

  it("ignores the keystroke while an IME is composing — it pages the candidate list", () => {
    expect(gridShortcutFor(key({ isComposing: true }), true)).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(gridShortcutFor(key({ key: "ArrowDown" }), true)).toBeNull();
    expect(gridShortcutFor(key({ key: "Enter" }), true)).toBeNull();
    expect(gridShortcutFor(key({ key: "" }), true)).toBeNull();
    // A key literally named like an Object.prototype member must not read through the chain.
    expect(gridShortcutFor(key({ key: "constructor" }), true)).toBeNull();
    expect(gridShortcutFor(key({ key: "toString" }), true)).toBeNull();
  });
});

describe("isEditableTarget", () => {
  it("treats form fields as editable", () => {
    expect(isEditableTarget("INPUT", [])).toBe(true);
    expect(isEditableTarget("TEXTAREA", [])).toBe(true);
    expect(isEditableTarget("SELECT", [])).toBe(true);
  });

  it("does NOT treat xterm's helper textarea as editable — the shortcut must work there", () => {
    expect(isEditableTarget("TEXTAREA", ["xterm-helper-textarea"])).toBe(false);
  });

  it("keeps other classes on a textarea editable", () => {
    expect(isEditableTarget("TEXTAREA", ["some-other-class"])).toBe(true);
  });

  it("is case-insensitive about the tag name", () => {
    expect(isEditableTarget("input", [])).toBe(true);
    expect(isEditableTarget("textarea", [])).toBe(true);
  });

  it("leaves non-form elements alone", () => {
    expect(isEditableTarget("DIV", [])).toBe(false);
    expect(isEditableTarget("BUTTON", [])).toBe(false);
    expect(isEditableTarget("", [])).toBe(false);
  });
});
