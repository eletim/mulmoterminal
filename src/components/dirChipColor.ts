import { isHexColor } from "./hexColor";
import type { DirChrome } from "../../common/dirChrome";

// Which of a directory's configured colours represents it on a launch chip. A chip is too
// small to carry more than one, so it takes whichever the grid makes most visible, in that
// order: the cell header's background, then the name badge, then the cell body, then the
// idle status dot. A directory that configured none stays uncoloured.
export function dirChipColor(chrome: Pick<DirChrome, "headerColor" | "badgeColor" | "cellColor" | "dotColor">): string | null {
  return [chrome.headerColor, chrome.badgeColor, chrome.cellColor, chrome.dotColor].find(isHexColor) ?? null;
}

// How much of the chip the colour gets beyond its leading stripe. A wash this faint stays
// behind 12px text at every hue — the stripe is what you actually read the colour off, and
// this is what makes it visible from across the form.
const CHIP_TINT_PERCENT = 14;
const CHIP_BORDER_PERCENT = 55;

// Left empty while a session is already running in that directory: the chip's blue is a STATE,
// and two meanings on one background is how both stop being legible. The stripe still carries
// the directory's colour there, so the two facts remain readable side by side.
export function dirChipTint(color: string | null, running: boolean): Record<string, string> {
  if (!color || running) return {};
  return {
    background: `color-mix(in srgb, ${color} ${CHIP_TINT_PERCENT}%, var(--bg-elevated))`,
    borderColor: `color-mix(in srgb, ${color} ${CHIP_BORDER_PERCENT}%, var(--border))`,
  };
}
