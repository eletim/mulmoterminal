// The synthesis half of the #729 mouse-tracking swallow. Dropping the tracking SETs keeps a drag
// a text selection, but it also hides the mouse from the app:
//
// - the wheel: xterm treats an alt-buffer app as "no scrollback, no mouse" and converts wheel
//   events into arrow keys — which a TUI like Claude binds to input history, so scrolling spun
//   the prompt history instead (#737);
// - clicks: the app's own click targets ("Jump to bottom", "1 new message") never hear from the
//   pointer, so they read as dead buttons (#845).
//
// The repair for both: remember which tracking modes were swallowed, and when the swallowed app
// is in the alternate buffer, hand it the SGR report it originally asked for. Drags stay
// selections.

const WHEEL_TRACKING_MODES = new Set([1000, 1001, 1002, 1003]);
const SGR_ENCODING_MODE = 1006;
const WHEEL_UP_BUTTON = 64;
const WHEEL_DOWN_BUTTON = 65;
const MAIN_BUTTON = 0;
// A press and release within this distance is a click, not a drag: it absorbs the pointer drift
// of an ordinary click without swallowing the start of a real selection.
const CLICK_SLOP_PX = 3;

const modeOf = (param: number | number[]): number | undefined => (Array.isArray(param) ? param[0] : param);

/** Record the modes of a swallowed SET, so the mouse handlers know what the app wanted. */
export function recordSwallowedModes(active: Set<number>, params: readonly (number | number[])[]): void {
  params.forEach((param) => {
    const mode = modeOf(param);
    if (mode !== undefined) active.add(mode);
  });
}

/** Forget modes the app reset — resets pass through to xterm untouched (#729), but the
 *  record must follow them or a closed TUI would keep synthesizing reports forever. */
export function clearResetModes(active: Set<number>, params: readonly (number | number[])[]): void {
  params.forEach((param) => {
    const mode = modeOf(param);
    if (mode !== undefined) active.delete(mode);
  });
}

/** True when the app asked for mouse tracking AND the SGR encoding. Non-SGR encodings are
 *  deliberately out of scope: every current target (Claude, Codex) requests 1006, and
 *  synthesizing legacy X10 bytes for the rest isn't worth the surface. */
export function wantsMouseReports(active: ReadonlySet<number>): boolean {
  if (!active.has(SGR_ENCODING_MODE)) return false;
  return [...active].some((mode) => WHEEL_TRACKING_MODES.has(mode));
}

const sgrReport = (button: number, col: number, row: number, released = false): string => `\x1b[<${button};${col};${row}${released ? "m" : "M"}`;

/** The SGR wheel report for a wheel movement, or null when there is no vertical motion.
 *  Button 64 is wheel-up, 65 wheel-down; col/row are 1-based cell coordinates. */
export function wheelReportSequence(deltaY: number, col: number, row: number): string | null {
  if (deltaY === 0) return null;
  return sgrReport(deltaY < 0 ? WHEEL_UP_BUTTON : WHEEL_DOWN_BUTTON, col, row);
}

/** The press/release pair for a main-button click on a 1-based cell. Both are sent because
 *  which of the two a TUI acts on is its own choice — a real terminal delivers both. */
export function clickReportSequences(col: number, row: number): [string, string] {
  return [sgrReport(MAIN_BUTTON, col, row), sgrReport(MAIN_BUTTON, col, row, true)];
}

export interface PointerPosition {
  clientX: number;
  clientY: number;
}

export interface GridCell {
  col: number;
  row: number;
}

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 1), max);

/** The 1-based cell under a pointer position, clamped to the grid. xterm 6 exposes no
 *  pixel-to-cell mapping, so the cell size comes from the screen element's own box. */
export function cellFromPoint(rect: DOMRect, cols: number, rows: number, pointer: PointerPosition): GridCell {
  if (rect.width <= 0 || rect.height <= 0 || cols <= 0 || rows <= 0) return { col: 1, row: 1 };
  const col = Math.floor((pointer.clientX - rect.left) / (rect.width / cols)) + 1;
  const row = Math.floor((pointer.clientY - rect.top) / (rect.height / rows)) + 1;
  return { col: clamp(col, cols), row: clamp(row, rows) };
}

/** True when the pointer barely moved between press and release. A wider move is a drag,
 *  which stays a text selection (#729) and must not be reported as a click. */
export function isClickGesture(from: PointerPosition, to: PointerPosition): boolean {
  return Math.abs(to.clientX - from.clientX) <= CLICK_SLOP_PX && Math.abs(to.clientY - from.clientY) <= CLICK_SLOP_PX;
}
