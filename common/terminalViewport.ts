import { isRecord } from "./isRecord";
import { MAX_TERM_COLS, MAX_TERM_ROWS, MIN_TERM_ROWS } from "./terminalSize";

export interface BrowserTerminalViewport {
  content: string;
  /** Terminal-state bytes to apply before clearing and drawing this snapshot. Transport-internal;
   * callers never generate or interpret them. */
  restore?: string;
  cursor: string;
  live: boolean;
  cols: number;
  screenRows: number;
  viewportRows: number;
  historyRows: number;
  historyLimit: number;
  clamped: boolean;
  rebased: boolean;
}

export interface BrowserTerminalCell {
  column: number;
  row: number;
}

export type BrowserScrollDirection = "up" | "down";

export interface BrowserViewportRequest {
  type: "viewport";
  requestId: number;
  rows: number;
  cursor?: string;
  /** Ephemeral initial-cache seek. Mutually exclusive with cursor; 0 is oldest and 1 is live. */
  fraction?: number;
}

export interface BrowserScrollRequest {
  type: "scroll";
  requestId: number;
  direction: BrowserScrollDirection;
  lines: number;
  rows: number;
  cursor?: string;
  cell?: BrowserTerminalCell;
}

function isIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function hasRequestId(value: Record<string, unknown>): value is Record<string, unknown> & { requestId: number } {
  return typeof value.requestId === "number" && Number.isSafeInteger(value.requestId) && value.requestId >= 1;
}

export function isViewportRequest(value: Record<string, unknown>): value is Record<string, unknown> & BrowserViewportRequest {
  return (
    value.type === "viewport" &&
    hasRequestId(value) &&
    isIntegerBetween(value.rows, MIN_TERM_ROWS, MAX_TERM_ROWS) &&
    (value.cursor === undefined || typeof value.cursor === "string") &&
    (value.fraction === undefined || (typeof value.fraction === "number" && Number.isFinite(value.fraction) && value.fraction >= 0 && value.fraction <= 1)) &&
    !(value.cursor !== undefined && value.fraction !== undefined)
  );
}

export function isScrollRequest(value: Record<string, unknown>): value is Record<string, unknown> & BrowserScrollRequest {
  if (value.type !== "scroll" || !hasRequestId(value) || (value.direction !== "up" && value.direction !== "down")) return false;
  if (!isIntegerBetween(value.lines, 1, MAX_TERM_ROWS) || !isIntegerBetween(value.rows, MIN_TERM_ROWS, MAX_TERM_ROWS)) return false;
  if (value.cursor !== undefined && typeof value.cursor !== "string") return false;
  if (value.cell === undefined) return true;
  return isRecord(value.cell) && isIntegerBetween(value.cell.column, 1, MAX_TERM_COLS) && isIntegerBetween(value.cell.row, 1, MAX_TERM_ROWS);
}

export function terminalViewportOf(value: unknown): BrowserTerminalViewport | null {
  if (!isRecord(value)) return null;
  if (typeof value.content !== "string" || typeof value.cursor !== "string" || typeof value.live !== "boolean") return null;
  if (typeof value.clamped !== "boolean" || typeof value.rebased !== "boolean") return null;
  if (!isIntegerBetween(value.cols, 0, Number.MAX_SAFE_INTEGER) || !isIntegerBetween(value.screenRows, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (!isIntegerBetween(value.viewportRows, 0, Number.MAX_SAFE_INTEGER) || !isIntegerBetween(value.historyRows, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (!isIntegerBetween(value.historyLimit, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (value.restore !== undefined && typeof value.restore !== "string") return null;
  return {
    content: value.content,
    ...(typeof value.restore === "string" ? { restore: value.restore } : {}),
    cursor: value.cursor,
    live: value.live,
    cols: value.cols,
    screenRows: value.screenRows,
    viewportRows: value.viewportRows,
    historyRows: value.historyRows,
    historyLimit: value.historyLimit,
    clamped: value.clamped,
    rebased: value.rebased,
  };
}
