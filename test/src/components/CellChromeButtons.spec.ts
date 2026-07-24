import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CellChromeButtons from "../../../src/components/CellChromeButtons.vue";

const mountButtons = (expanded = false) => mount(CellChromeButtons, { props: { expanded } });

const scopeIds = (html: string): string[] => [...html.matchAll(/data-v-[0-9a-f]+/g)].map((m) => m[0]);

describe("CellChromeButtons", () => {
  // The shared .cell-btn / .cell-close rules are SCOPED CSS (cellChromeBase.css), so they
  // only reach these buttons while the component has a scope id of its own — a fragment root
  // never inherits the parent cell's. Without one both buttons rendered with the browser's
  // default button chrome while the neighbouring ◀ ▶ (in the cell's own template) did not (#787).
  it("stamps a scope id on both buttons, so the shared cell-btn styles apply", () => {
    const w = mountButtons();
    expect(scopeIds(w.find('[aria-label="Expand terminal"]').html())).not.toHaveLength(0);
    expect(scopeIds(w.find('[aria-label="Close terminal"]').html())).not.toHaveLength(0);
  });

  it("carries the shared chrome classes the styles key off", () => {
    const w = mountButtons();
    expect(w.find('[aria-label="Expand terminal"]').classes()).toContain("cell-btn");
    expect(w.find('[aria-label="Close terminal"]').classes()).toEqual(expect.arrayContaining(["cell-btn", "cell-close"]));
  });

  it("offers expand while tiled and restore while expanded", () => {
    expect(mountButtons(false).find(".cell-btn").text()).toBe("⤢");
    const expanded = mountButtons(true);
    expect(expanded.find(".cell-btn").text()).toBe("⤡");
    expect(expanded.find(".cell-btn").attributes("title")).toBe("Restore");
    expect(expanded.find('[aria-label="Restore terminal"]').exists()).toBe(true);
  });

  it("emits toggle-expand and close from their own buttons", async () => {
    const w = mountButtons();
    await w.find('[aria-label="Expand terminal"]').trigger("click");
    await w.find('[aria-label="Close terminal"]').trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
    expect(w.emitted("close")).toHaveLength(1);
  });
});
