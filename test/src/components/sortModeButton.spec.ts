import { describe, it, expect } from "vitest";
import { nextSortMode, sortModeButton } from "../../../src/components/sortModeButton";
import type { SortMode } from "../../../src/components/gridTabs";

const MODES: SortMode[] = ["auto", "manual", "priority"];

describe("nextSortMode", () => {
  // The button is the ONLY way to reach "priority", so a cycle that skipped a mode would
  // strand the feature with no other route to it.
  it("visits every mode and returns to the start", () => {
    const seen = [nextSortMode("auto"), nextSortMode(nextSortMode("auto")), nextSortMode(nextSortMode(nextSortMode("auto")))];
    expect(seen).toEqual(["manual", "priority", "auto"]);
    expect(new Set(seen)).toEqual(new Set(MODES));
  });

  it("never returns the mode it was given", () => {
    MODES.forEach((mode) => expect(nextSortMode(mode)).not.toBe(mode));
  });
});

describe("sortModeButton", () => {
  it("gives each mode its own icon", () => {
    const icons = MODES.map((m) => sortModeButton(m).icon);
    expect(new Set(icons).size).toBe(MODES.length);
  });

  // With three states there is no aria-pressed to lean on, so the accessible name is the only
  // thing telling a screen-reader user which ordering is live.
  it("names the current mode and what one click does", () => {
    MODES.forEach((mode) => {
      const { label } = sortModeButton(mode);
      expect(label).toContain(mode);
      expect(label).toContain(nextSortMode(mode));
    });
  });

  it("highlights only the automatic orderings, not the hand-arranged one", () => {
    expect(sortModeButton("manual").active).toBe(false);
    expect(sortModeButton("auto").active).toBe(true);
    expect(sortModeButton("priority").active).toBe(true);
  });

  it("explains what priority order means, since the key lives in a file", () => {
    expect(sortModeButton("priority").title).toContain("orderPriority");
  });
});
