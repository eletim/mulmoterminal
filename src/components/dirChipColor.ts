import { isHexColor } from "./hexColor";
import type { DirChrome } from "../../common/dirChrome";

// Which of a directory's configured colours represents it on a launch chip. A chip is too
// small to carry more than one, so it takes whichever the grid makes most visible, in that
// order: the cell header's background, then the name badge, then the cell body, then the
// idle status dot. A directory that configured none stays uncoloured.
export function dirChipColor(chrome: Pick<DirChrome, "headerColor" | "badgeColor" | "cellColor" | "dotColor">): string | null {
  return [chrome.headerColor, chrome.badgeColor, chrome.cellColor, chrome.dotColor].find(isHexColor) ?? null;
}
