import type { BrowserTerminalViewport } from "../../common/terminalViewport";

export const VIEWPORT_CACHE_MAX_CHUNKS = 5;
export const VIEWPORT_CACHE_PREFETCH_CHUNKS = 1;

export interface ViewportCacheChunk {
  cursor: string;
  live: boolean;
  rows: string[];
}

export interface ViewportCacheAnchor {
  cursor: string;
  offset: number;
}

function physicalRows(content: string, expected: number): string[] {
  const rows = content.replace(/\n$/, "").split(/\r?\n/);
  if (rows.length > expected) return rows.slice(0, expected);
  while (rows.length < expected) rows.push("");
  return rows;
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

  /** Core bookmark plus the transient row offset from that chunk's first row. */
  get anchor(): ViewportCacheAnchor | null {
    if (this.empty) return null;
    const chunkIndex = Math.min(Math.floor(this.start / this.visibleRows), this.chunks.length - 1);
    const chunk = this.chunks[chunkIndex];
    if (!chunk) return null;
    return { cursor: chunk.cursor, offset: this.start - chunkIndex * this.visibleRows };
  }

  reset(viewport?: BrowserTerminalViewport): void {
    this.chunks = [];
    this.start = 0;
    if (viewport) this.chunks.push(this.chunk(viewport));
  }

  prepend(viewport: BrowserTerminalViewport): void {
    const chunk = this.chunk(viewport);
    this.chunks.unshift(chunk);
    this.start += chunk.rows.length;
    this.evict();
  }

  append(viewport: BrowserTerminalViewport): void {
    this.chunks.push(this.chunk(viewport));
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

  content(): string {
    return this.allRows()
      .slice(this.start, this.start + this.visibleRows)
      .join("\n");
  }

  shouldPrefetchOlder(): boolean {
    return !this.empty && this.rowsBefore <= this.visibleRows * VIEWPORT_CACHE_PREFETCH_CHUNKS;
  }

  shouldPrefetchNewer(): boolean {
    return !this.empty && !this.hasLiveBoundary && this.rowsAfter <= this.visibleRows * VIEWPORT_CACHE_PREFETCH_CHUNKS;
  }

  private chunk(viewport: BrowserTerminalViewport): ViewportCacheChunk {
    return {
      cursor: viewport.cursor,
      live: viewport.live,
      rows: physicalRows(viewport.content, this.visibleRows),
    };
  }

  private allRows(): string[] {
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
