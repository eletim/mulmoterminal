// The xterm-facing half of the #729 mouse-tracking swallow: the wheel (#737) and the click
// (#845) handlers that hand a swallowed app the SGR reports it asked for. The rules they apply
// (what the app wants, where the pointer is, click vs drag, the byte sequences) are pure and
// live in ./mouseReports; what is here is the wiring onto a live Terminal.
import type { Terminal } from "@xterm/xterm";
import { cellFromPoint, clickReportSequences, isClickGesture, wantsMouseReports, wheelReportSequence } from "./mouseReports";
import type { GridCell, PointerPosition } from "./mouseReports";

// xterm's Linkifier marks the screen element while a link is under the pointer. That click
// already has an owner (the link's activate handler), so reporting it too would fire both.
const LINK_HOVER_CLASS = "xterm-cursor-pointer";
const MAIN_BUTTON = 0;
const TOP_LEFT_CELL: GridCell = { col: 1, row: 1 };

// The app hears the mouse only while it is the full-screen owner of the terminal AND asked for
// tracking it never got (#729). Both halves below answer to this one gate.
const reportsMouseToApp = (term: Terminal, swallowedMouseModes: ReadonlySet<number>): boolean =>
  term.buffer.active.type === "alternate" && wantsMouseReports(swallowedMouseModes);

const screenElementOf = (term: Terminal): HTMLElement | null => term.element?.querySelector(".xterm-screen") ?? null;

// Cells are measured off the screen element's own box, since xterm exposes no pixel-to-cell
// mapping. A terminal that isn't laid out yet reports the top-left cell rather than nothing:
// for the wheel, arriving matters more than the coordinate.
function cellUnderPointer(term: Terminal, pointer: PointerPosition): GridCell {
  const screen = screenElementOf(term);
  if (!screen) return TOP_LEFT_CELL;
  return cellFromPoint(screen.getBoundingClientRect(), term.cols, term.rows, pointer);
}

/** Wheel -> the SGR wheel report the app asked for. Without this xterm converts the wheel into
 *  arrow keys for an alt-buffer app, which a TUI binds to input history — so scrolling spun the
 *  prompt history instead of the transcript (#737). */
export function guardMouseWheel(term: Terminal, swallowedMouseModes: ReadonlySet<number>): void {
  term.attachCustomWheelEventHandler((ev) => {
    if (!reportsMouseToApp(term, swallowedMouseModes)) return true;
    const cell = cellUnderPointer(term, ev);
    const seq = wheelReportSequence(ev.deltaY, cell.col, cell.row);
    if (!seq) return true;
    term.input(seq, false);
    ev.preventDefault();
    return false;
  });
}

/** Click -> the SGR press/release pair, so a TUI's own click targets ("Jump to bottom", "1 new
 *  message") respond (#845). Only a press and release that stayed put reports: a drag is still a
 *  text selection, which is what the swallow exists to protect. Nothing is preventDefault()ed,
 *  so xterm's selection is untouched.
 *
 *  Call AFTER term.open() — `term.element` does not exist before it. The listeners live on the
 *  terminal's own DOM, so they go away with it (dispose) and survive re-parenting (attach). */
export function guardMouseClicks(term: Terminal, swallowedMouseModes: ReadonlySet<number>): void {
  const screen = screenElementOf(term);
  if (!screen) return;
  let pressedAt: PointerPosition | null = null;
  screen.addEventListener("mousedown", (ev) => {
    pressedAt = ev.button === MAIN_BUTTON ? { clientX: ev.clientX, clientY: ev.clientY } : null;
  });
  screen.addEventListener("mouseup", (ev) => {
    const from = pressedAt;
    pressedAt = null;
    if (!from || ev.button !== MAIN_BUTTON || !isClickGesture(from, ev)) return;
    if (!reportsMouseToApp(term, swallowedMouseModes) || screen.classList.contains(LINK_HOVER_CLASS)) return;
    const cell = cellUnderPointer(term, ev);
    clickReportSequences(cell.col, cell.row).forEach((seq) => term.input(seq, false));
  });
}
