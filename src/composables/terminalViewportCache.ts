import type { BrowserTerminalViewport } from "../../common/terminalViewport";
import type { ParsedTerminalLine, ParsedTerminalSnapshot } from "./terminalParsedBufferAdapter";

export const VIEWPORT_CACHE_MAX_CHUNKS = 5;
export const VIEWPORT_CACHE_PREFETCH_CHUNKS = 1;

export interface ViewportCacheChunk {
  cursor: string;
  live: boolean;
  rows: readonly ParsedTerminalLine[];
  cursorX: number;
  cursorY: number;
  restore: string;
}

export interface ViewportCacheAnchor {
  cursor: string;
  offset: number;
}

/**
 * Viewer-local, disposable physical-row cache. Cursors remain opaque boundary bookmarks; the
 * numeric offset below is only an index into this in-memory array and never leaves the browser.
 */
export class TerminalViewportCache {
  readonly visibleRows: number;
  readonly maxChunks: number;
  private chunks: ViewportCacheChunk[] = [];
  private start = 0;

  constructor(visibleRows: number, maxChunks = VIEWPORT_CACHE_MAX_CHUNKS) {
    this.visibleRows = visibleRows;
    this.maxChunks = maxChunks;
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  get empty(): boolean {
    return this.chunks.length === 0;
  }

  get rowsBefore(): number {
    return this.start;
  }

  get rowsAfter(): number {
    return Math.max(0, this.allRows().length - this.visibleRows - this.start);
  }

  get oldestCursor(): string | null {
    return this.chunks[0]?.cursor ?? null;
  }

  get newestCursor(): string | null {
    return this.chunks.at(-1)?.cursor ?? null;
  }

  get hasLiveBoundary(): boolean {
    return this.chunks.at(-1)?.live ?? false;
  }

  get atLiveBoundary(): boolean {
    return this.hasLiveBoundary && this.rowsAfter === 0;
  }

  get viewportStart(): number {
    return this.start;
  }

  get parsedRows(): readonly ParsedTerminalLine[] {
    return this.allRows();
  }

  get renderCursor(): { x: number; y: number; restore: string } {
    const chunk = this.chunks.at(-1);
    return { x: chunk?.cursorX ?? 0, y: chunk?.cursorY ?? this.visibleRows - 1, restore: chunk?.restore ?? "" };
  }

  /** Core bookmark plus the transient row offset from that chunk's first row. */
  get anchor(): ViewportCacheAnchor | null {
    if (this.empty) return null;
    const chunkIndex = Math.min(Math.floor(this.start / this.visibleRows), this.chunks.length - 1);
    const chunk = this.chunks[chunkIndex];
    if (!chunk) return null;
    return { cursor: chunk.cursor, offset: this.start - chunkIndex * this.visibleRows };
  }

  reset(viewport?: BrowserTerminalViewport, parsed?: ParsedTerminalSnapshot): void {
    this.chunks = [];
    this.start = 0;
    if (viewport && parsed) this.chunks.push(this.chunk(viewport, parsed));
  }

  prepend(viewport: BrowserTerminalViewport, parsed: ParsedTerminalSnapshot): void {
    const chunk = this.chunk(viewport, parsed);
    this.chunks.unshift(chunk);
    this.start += chunk.rows.length;
    this.evict();
  }

  append(viewport: BrowserTerminalViewport, parsed: ParsedTerminalSnapshot): void {
    this.chunks.push(this.chunk(viewport, parsed));
    this.evict();
  }

  move(lines: number): boolean {
    if (!Number.isInteger(lines) || lines === 0 || this.empty) return false;
    const next = this.start + lines;
    const maximum = Math.max(0, this.allRows().length - this.visibleRows);
    if (next < 0 || next > maximum) return false;
    this.start = next;
    return true;
  }

  shouldPrefetchOlder(): boolean {
    return !this.empty && this.rowsBefore <= this.visibleRows * VIEWPORT_CACHE_PREFETCH_CHUNKS;
  }

  shouldPrefetchNewer(): boolean {
    return !this.empty && !this.hasLiveBoundary && this.rowsAfter <= this.visibleRows * VIEWPORT_CACHE_PREFETCH_CHUNKS;
  }

  private chunk(viewport: BrowserTerminalViewport, parsed: ParsedTerminalSnapshot): ViewportCacheChunk {
    return {
      cursor: viewport.cursor,
      live: viewport.live,
      rows: parsed.rows,
      cursorX: parsed.cursorX,
      cursorY: parsed.cursorY,
      restore: parsed.restore,
    };
  }

  private allRows(): ParsedTerminalLine[] {
    return this.chunks.flatMap((chunk) => chunk.rows);
  }

  private evict(): void {
    while (this.chunks.length > this.maxChunks) {
      const totalRows = this.allRows().length;
      const viewportCenter = this.start + this.visibleRows / 2;
      if (viewportCenter < totalRows / 2) {
        this.chunks.pop();
      } else {
        const removed = this.chunks.shift();
        this.start = Math.max(0, this.start - (removed?.rows.length ?? 0));
      }
    }
  }
}
