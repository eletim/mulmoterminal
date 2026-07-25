import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CellChromeButtons from "../../../src/components/CellChromeButtons.vue";
import { CELL_BTN, CELL_CLOSE_BTN } from "../../../src/components/cellChromeClasses";

const mountButtons = (expanded = false) => mount(CellChromeButtons, { props: { expanded } });

describe("CellChromeButtons", () => {
  // Both buttons must carry their styling as utilities. As scoped CSS it reached neither: this
  // component's template has a fragment root, and Vue gives the parent cell's scope id to a
  // single root element only — so both rendered with the browser's default button chrome while
  // the neighbouring ◀ ▶ (in the cell's own template) did not (#787, #791).
  it("styles both buttons with utilities rather than a stylesheet", () => {
    const w = mountButtons();
    expect(w.find('[aria-label="Expand terminal"]').classes()).toEqual(expect.arrayContaining(CELL_BTN.split(" ")));
    expect(w.find('[aria-label="Close terminal"]').classes()).toEqual(expect.arrayContaining(CELL_CLOSE_BTN.split(" ")));
  });

  // The close button's red hover is the whole reason it isn't just CELL_BTN.
  it("gives the close button its own hover colours", () => {
    expect(mountButtons().find('[aria-label="Close terminal"]').classes()).not.toContain("hover:bg-hover");
  });

  it("keeps the cell-btn / cell-close hooks the grid and the specs select on", () => {
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
