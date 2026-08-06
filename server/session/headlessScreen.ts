// Render a session's buffered PTY output into the screen it would have produced, for
// sessions tmux can't be asked about (tmux absent, or a non-persistent spawn). Feeds the
// bounded tail through a headless emulator and reads back the visible rows — the same
// restore the browser performs on reattach, minus the browser.
//
// Terminal queries are NOT stripped here (unlike the reattach replay): the emulator's
// replies go to an onData nobody listens to, and queries render nothing either way.
// Imported as a DEFAULT, not `import { Terminal }`. The package ships a UMD/CJS bundle
// and its `module` field points at a path that doesn't exist, so Node's ESM loader falls
// back to CJS and can't statically see the named export — a bare named import throws at
// startup under `node --import tsx`, even though bundlers (and vitest) resolve it fine.
import headless from "@xterm/headless";
import type { IBufferCell, IBufferLine } from "@xterm/headless";
import type { ScreenRow } from "./screen-rows.js";
import { resolveIndexColor, rgbHex, trimTrailingBlankAnsiRows, trimTrailingPad } from "./ansiSegments.js";
import type { AnsiRow, AnsiSegment } from "../../common/ansiStyle.js";

const { Terminal } = headless;

export interface HeadlessScreenInput {
  buffer: string;
  cols: number;
  rows: number;
  // How much scrollback to read above the visible pane, so this path yields the same
  // window as the tmux one (`capture-pane -S -n`).
  historyLines: number;
}

// Dim is read off the cells rather than re-parsed out of the buffer, so this path yields
// the same ScreenRow shape as a tmux capture and the suggestion rule stays single.
const rowOf = (line: IBufferLine | undefined, cols: number): ScreenRow => {
  if (!line) return { text: "", dim: "" };
  const cells = Array.from({ length: cols }, (_, column) => line.getCell(column));
  return {
    text: line.translateToString(true),
    dim: cells.flatMap((cell) => (cell?.isDim() ? [cell.getChars()] : [])).join(""),
  };
};

// Shared by renderScreen and renderAnsiRows below: write the buffer into a fresh headless
// emulator, work out the same top-of-window row both callers need, and hand the finished
// buffer to `mapRow` before disposing the terminal — so the two functions differ only in
// what they read off each line, never in the write/window/dispose dance around it.
async function withRenderedBuffer<T>({ buffer, cols, rows, historyLines }: HeadlessScreenInput, mapRow: (line: IBufferLine | undefined) => T): Promise<T[]> {
  // `buffer` is still proposed API in xterm 6; reading it (and the cells below) throws
  // without this opt-in. `scrollback` is stated rather than left at xterm's default, so
  // asking for more history than the emulator keeps can't silently return less.
  const term = new Terminal({ cols, rows, scrollback: historyLines, allowProposedApi: true });
  try {
    // `term.write` is ASYNC — the callback fires once the parser has consumed the chunk, and
    // reading `buffer.active` before that yields an EMPTY screen. The await is load-bearing.
    await new Promise<void>((resolve) => term.write(buffer, resolve));
    const active = term.buffer.active;
    // baseY is the top of the viewport, so reading from above it is what picks up the
    // scrollback — matching what `tmux capture-pane -S -n` returns. Clamped at 0: a
    // session with less history than asked for simply yields less.
    const top = Math.max(0, active.baseY - historyLines);
    return Array.from({ length: active.baseY - top + rows }, (_, row) => mapRow(active.getLine(top + row)));
  } finally {
    term.dispose();
  }
}

export async function renderScreen(input: HeadlessScreenInput): Promise<ScreenRow[]> {
  return withRenderedBuffer(input, (line) => rowOf(line, input.cols));
}

// A cell's resolved colour, or null for "default" — the same null a segment with no colour
// code in effect carries on the wire (common/ansiStyle.ts). Reads the emulator's own resolved
// per-cell state directly rather than re-parsing escapes out of text, which is both simpler and
// more exact than ansiSegments.ts's regex walk: xterm has already done the parsing, this only
// asks it what it decided.
const rgbHexOf = (packed: number): string => rgbHex((packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff);

const cellFg = (cell: IBufferCell): string | null => {
  if (cell.isFgDefault()) return null;
  if (cell.isFgRGB()) return rgbHexOf(cell.getFgColor());
  return resolveIndexColor(cell.getFgColor());
};

const cellBg = (cell: IBufferCell): string | null => {
  if (cell.isBgDefault()) return null;
  if (cell.isBgRGB()) return rgbHexOf(cell.getBgColor());
  return resolveIndexColor(cell.getBgColor());
};

// Runs of consecutive cells sharing one style, merged into segments the same shape
// ansiSegments.ts's tmux-text path produces — the two capture routes converge on one wire
// type before this ever reaches the route handler. A width-0 cell (the second half of a wide
// CJK/emoji glyph) is skipped: its content already came out of the preceding cell's getChars().
const ansiRowOf = (line: IBufferLine | undefined, cols: number): AnsiRow => {
  if (!line) return [];
  const segments: AnsiSegment[] = [];
  let current: AnsiSegment | null = null;
  for (let column = 0; column < cols; column++) {
    const cell = line.getCell(column);
    if (!cell || cell.getWidth() === 0) continue;
    const chars = cell.getChars();
    const text = chars === "" ? " " : chars;
    const fg = cellFg(cell);
    const bg = cellBg(cell);
    const bold = cell.isBold() !== 0;
    if (current && current.fg === fg && current.bg === bg && current.bold === bold) {
      current.text += text;
    } else {
      if (current) segments.push(current);
      current = { text, fg, bg, bold };
    }
  }
  if (current) segments.push(current);
  return trimTrailingPad(segments);
};

// The fallback capture route's styled screen (#7) — the same emulator renderScreen already
// runs over the SAME buffer, read for colour instead of for dim. Trimmed to the rows that
// actually hold content the same way the tmux-text route's parseAnsiRows result is, so the
// two routes agree on where the screen ends.
export async function renderAnsiRows(input: HeadlessScreenInput): Promise<AnsiRow[]> {
  const rows = await withRenderedBuffer(input, (line) => ansiRowOf(line, input.cols));
  return trimTrailingBlankAnsiRows(rows);
}
