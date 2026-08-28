import { describe, expect, it } from "vitest";
import type { BrowserTerminalViewport } from "../../../common/terminalViewport";
import type { ParsedTerminalLine, ParsedTerminalSnapshot } from "../../../src/composables/terminalParsedBufferAdapter";
import { TerminalViewportCache, VIEWPORT_CACHE_MAX_CHUNKS } from "../../../src/composables/terminalViewportCache";

function viewport(first: number, rows = 30, live = false): BrowserTerminalViewport {
  return {
    content: Array.from({ length: rows }, (_, index) => String(first + index)).join("\n") + "\n",
    cursor: `opaque-${first}`,
    live,
    cols: 80,
    screenRows: rows,
    viewportRows: rows,
    historyRows: 1000,
    historyLimit: 20_000,
    clamped: false,
    rebased: false,
  };
}

function parsed(first: number, rows = 30): ParsedTerminalSnapshot {
  return {
    rows: Array.from({ length: rows }, (_, index) => ({
      line: { translateToString: () => String(first + index) },
    })) as unknown as ParsedTerminalLine[],
    cursorX: 0,
    cursorY: rows - 1,
    restore: "",
  };
}

const visible = (cache: TerminalViewportCache): string[] =>
  cache.parsedRows.slice(cache.viewportStart, cache.viewportStart + cache.visibleRows).map((row) => row.line.translateToString(true));

describe("TerminalViewportCache", () => {
  it("uses visibleRows as its chunk size and builds an older-prefetched R=30 cache", () => {
    const cache = new TerminalViewportCache(30);
    cache.reset(viewport(61, 30, true), parsed(61));
    cache.prepend(viewport(31), parsed(31));
    cache.prepend(viewport(1), parsed(1));

    expect(cache.chunkCount).toBe(3);
    expect(visible(cache)).toEqual(Array.from({ length: 30 }, (_, index) => String(61 + index)));
    expect(cache.rowsBefore).toBe(60);
  });

  it("moves a viewport wholly inside cached physical rows", () => {
    const cache = new TerminalViewportCache(30);
    cache.reset(viewport(61, 30, true), parsed(61));
    cache.prepend(viewport(31), parsed(31));

    expect(cache.move(-6)).toBe(true);
    expect(cache.anchor).toEqual({ cursor: "opaque-31", offset: 24 });
    expect(visible(cache)).toEqual(Array.from({ length: 30 }, (_, index) => String(55 + index)));
    expect(cache.move(6)).toBe(true);
    expect(cache.atLiveBoundary).toBe(true);
  });

  it("signals prefetch within one chunk of either non-live cache edge", () => {
    const cache = new TerminalViewportCache(30);
    cache.reset(viewport(61), parsed(61));
    cache.prepend(viewport(31), parsed(31));
    cache.prepend(viewport(1), parsed(1));
    expect(cache.shouldPrefetchOlder()).toBe(false);
    expect(cache.move(-30)).toBe(true);
    expect(cache.shouldPrefetchOlder()).toBe(true);
    expect(cache.shouldPrefetchNewer()).toBe(true);
  });

  it("appends a newer chunk without moving the current viewport", () => {
    const cache = new TerminalViewportCache(30);
    cache.reset(viewport(31), parsed(31));
    cache.prepend(viewport(1), parsed(1));
    expect(cache.move(-30)).toBe(true);
    expect(cache.shouldPrefetchNewer()).toBe(true);

    cache.append(viewport(61, 30, true), parsed(61));
    expect(visible(cache)[0]).toBe("1");
    expect(cache.rowsAfter).toBe(60);
    expect(cache.hasLiveBoundary).toBe(true);
  });

  it("evicts the farthest chunks and never exceeds five chunks", () => {
    const cache = new TerminalViewportCache(30);
    cache.reset(viewport(151, 30, true), parsed(151));
    for (const first of [121, 91, 61, 31, 1]) cache.prepend(viewport(first), parsed(first));

    expect(cache.chunkCount).toBe(VIEWPORT_CACHE_MAX_CHUNKS);
    expect(cache.newestCursor).toBe("opaque-151");
    expect(cache.oldestCursor).toBe("opaque-31");
  });

  it("keeps separate cache instances independent", () => {
    const a = new TerminalViewportCache(30);
    const b = new TerminalViewportCache(30);
    a.reset(viewport(61, 30, true), parsed(61));
    b.reset(viewport(901, 30, true), parsed(901));
    a.prepend(viewport(31), parsed(31));
    expect(a.move(-3)).toBe(true);

    expect(visible(a)[0]).toBe("58");
    expect(visible(b)[0]).toBe("901");
  });
});
