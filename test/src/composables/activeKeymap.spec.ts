import { describe, it, expect, beforeEach } from "vitest";
import { computed } from "vue";
import { activeKeymap, getActiveKeymap, setActiveKeymap } from "../../../src/composables/activeKeymap.js";
import { keymapRows } from "../../../src/components/keymapLabels.js";

describe("activeKeymap", () => {
  beforeEach(() => setActiveKeymap(undefined));

  it("starts empty — shortcuts are opt-in", () => {
    expect(getActiveKeymap()).toEqual({});
  });

  it("sanitizes what it is given, so a bad config.json can't reach the key handler", () => {
    setActiveKeymap({ "zoom-next": "PageDown", "warp-drive": "F1", "zoom-prev": "Shift+" });
    expect(getActiveKeymap()).toEqual({ "zoom-next": "PageDown" });
  });

  it("treats a missing keymap as empty", () => {
    setActiveKeymap({ "zoom-next": "PageDown" });
    setActiveKeymap(undefined);
    expect(getActiveKeymap()).toEqual({});
  });

  // Regression: /api/config is fetched asynchronously, so anything RENDERING the keymap must
  // see a late arrival. A snapshot taken before the fetch resolved would show every action as
  // unbound for as long as that screen stayed open.
  it("updates reactive consumers when the config arrives late", () => {
    const rows = computed(() => keymapRows(activeKeymap.value));
    expect(rows.value.every((r) => r.binding === null)).toBe(true);

    setActiveKeymap({ "zoom-toggle": "F8" });

    const toggle = rows.value.find((r) => r.action === "zoom-toggle");
    expect(toggle?.binding).toBe("F8");
    // Everything else still reads as unbound, and is still listed.
    expect(rows.value.filter((r) => r.binding === null)).toHaveLength(rows.value.length - 1);
  });
});

describe("keymapRows", () => {
  it("lists EVERY action, bound or not — an unbound row is how the action is discovered", () => {
    const rows = keymapRows({ "zoom-next": "PageDown" });
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => r.label.length > 0)).toBe(true);
    expect(rows.find((r) => r.action === "zoom-next")?.binding).toBe("PageDown");
    expect(rows.find((r) => r.action === "terminal-close")?.binding).toBeNull();
  });
});
