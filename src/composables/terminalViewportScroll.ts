import type { Terminal } from "@xterm/xterm";
import { MAX_TERM_ROWS, MIN_TERM_ROWS } from "../../common/terminalSize";
import { cellFromPoint, createWheelTicker, wheelNotches, type PointerPosition } from "./mouseReports";

export interface GenericScrollIntent {
  direction: "up" | "down";
  lines: number;
  cell: { column: number; row: number };
}

export function takeScrollChunk(lines: number): { lines: number; remaining: number } {
  const chunk = Math.sign(lines) * Math.min(Math.abs(lines), MAX_TERM_ROWS);
  return { lines: chunk, remaining: lines - chunk };
}

export function boundedViewportRows(rows: number): number {
  return Math.max(MIN_TERM_ROWS, Math.min(MAX_TERM_ROWS, Math.trunc(rows)));
}

function screenElementOf(term: Terminal): HTMLElement | null {
  return term.element?.querySelector(".xterm-screen") ?? null;
}

function cellHeightOf(term: Terminal): number {
  const screen = screenElementOf(term);
  if (!screen || term.rows <= 0) return 0;
  return screen.getBoundingClientRect().height / term.rows;
}

export function terminalCellAt(term: Terminal, pointer: PointerPosition): { column: number; row: number } {
  const screen = screenElementOf(term);
  if (!screen) return { column: 1, row: 1 };
  const cell = cellFromPoint(screen.getBoundingClientRect(), term.cols, term.rows, pointer);
  return { column: cell.col, row: cell.row };
}

export function wireGenericWheel(term: Terminal, enabled: () => boolean, scrollSpeed: () => number, send: (intent: GenericScrollIntent) => void): void {
  const ticker = createWheelTicker();
  term.attachCustomWheelEventHandler((event) => {
    if (!enabled()) {
      ticker.residual = 0;
      return true;
    }
    if (event.deltaY === 0) return false;
    const lines = wheelNotches(ticker, event, cellHeightOf(term), term.rows, scrollSpeed());
    event.preventDefault();
    if (lines !== 0) {
      send({
        direction: lines < 0 ? "up" : "down",
        lines: Math.abs(lines),
        cell: terminalCellAt(term, event),
      });
    }
    return false;
  });
}

export function viewportRenderData(content: string, restore = ""): string {
  const rows = content.replace(/\n$/, "").replace(/\r?\n/g, "\r\n");
  return `${restore}\x1b[H\x1b[2J${rows}`;
}
