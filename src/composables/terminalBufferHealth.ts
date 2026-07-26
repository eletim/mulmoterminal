// Detects the xterm 6.0.0 buffer corruption that kills a terminal outright (#846, upstream
// xtermjs/xterm.js#6063): `Buffer.resize` can finish with fewer lines than the viewport needs,
// and the next write to a bottom row then throws inside xterm's own task —
// `lineFeed`/`_eraseInBufferLine` dereference `lines.get(...)` without a null check.
//
// The throw is unreachable from here (it happens in the WriteBuffer's setTimeout, not under our
// call), and it leaves the write queue permanently stuck: WriteBuffer.write() only starts the
// drain when the queue WAS empty, so nothing the app writes afterwards is ever parsed. That is
// why the cell freezes until a page reload — and why the state has to be found by looking rather
// than by catching.
//
// Upstream's own flight recorder shows the buffer already short BEFORE the resize that made it
// fatal (stale CircularList slots mask it), so this probe usually fires while the terminal is
// still alive.

/** What the probe reads. All of it is public API — no `_core` internals. */
export interface BufferShape {
  length: number;
  baseY: number;
  cursorY: number;
  rows: number;
}

/** The slice of a terminal the probe needs. Structural rather than `Terminal`, so the headless
 *  build — the one the spec can drive through hundreds of resizes — satisfies it too. */
export interface MeasurableTerminal {
  rows: number;
  buffer: { active: { length: number; baseY: number; cursorY: number } };
}

/** True when the buffer has fewer lines than the terminal is about to address:
 *  the renderer reads `lines.get(ydisp + row)` for every viewport row, and the input handler
 *  writes `lines.get(ybase + y)`. Either one missing is a terminal that is dead or about to be. */
export function bufferIsShort({ length, baseY, cursorY, rows }: BufferShape): boolean {
  return length < baseY + rows || length <= baseY + cursorY;
}

export function readBufferShape(term: MeasurableTerminal): BufferShape {
  const buffer = term.buffer.active;
  return { length: buffer.length, baseY: buffer.baseY, cursorY: buffer.cursorY, rows: term.rows };
}
