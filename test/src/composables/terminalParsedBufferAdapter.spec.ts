import { Terminal } from "@xterm/xterm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BrowserTerminalViewport } from "../../../common/terminalViewport";
import { TerminalParsedBufferAdapter } from "../../../src/composables/terminalParsedBufferAdapter";

beforeAll(() => {
  window.matchMedia ??= () => ({ addListener() {}, removeListener() {} }) as unknown as MediaQueryList;
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => document.body.replaceChildren());

function viewport(content: string, cols = 8, rows = 3): BrowserTerminalViewport {
  return {
    content,
    cursor: "opaque",
    live: false,
    cols,
    screenRows: rows,
    viewportRows: rows,
    historyRows: 100,
    historyLimit: 20_000,
    clamped: false,
    rebased: false,
  };
}

function rowAt(rows: ReturnType<TerminalParsedBufferAdapter["parse"]>["rows"], index: number) {
  const row = rows[index];
  if (!row) throw new Error(`missing parsed row ${index}`);
  return row;
}

describe("TerminalParsedBufferAdapter", () => {
  it("keeps xterm-parsed foreground, background and text attributes", () => {
    const term = new Terminal({ cols: 8, rows: 3 });
    const adapter = new TerminalParsedBufferAdapter(term);
    const parsed = adapter.parse(viewport("\u001b[31;44;1;3;4mA\u001b[0m"));
    const cell = adapter.inspectCell(rowAt(parsed.rows, 0), 0);

    expect(cell).toMatchObject({ chars: "A", width: 1, foreground: 1, background: 4, bold: true, italic: true, underline: true });
    expect(adapter.metrics).toMatchObject({ ansiParseCount: 1, parsedChunkCount: 1, snapshotWriteCount: 0 });
    term.dispose();
  });

  it("preserves CJK width and combining characters", () => {
    const term = new Terminal({ cols: 8, rows: 3 });
    const adapter = new TerminalParsedBufferAdapter(term);
    const parsed = adapter.parse(viewport("日e\u0301"));

    expect(adapter.inspectCell(rowAt(parsed.rows, 0), 0)).toMatchObject({ chars: "日", width: 2 });
    expect(adapter.inspectCell(rowAt(parsed.rows, 0), 1)).toMatchObject({ chars: "", width: 0 });
    expect(adapter.inspectCell(rowAt(parsed.rows, 0), 2)).toMatchObject({ chars: "é", width: 1 });
    term.dispose();
  });

  it("retains xterm wrap metadata and erased blank cells", () => {
    const term = new Terminal({ cols: 4, rows: 3 });
    const adapter = new TerminalParsedBufferAdapter(term);
    const wrapped = adapter.parse(viewport("abcdef", 4, 3));
    const erased = adapter.parse(viewport("abc\u001b[2K", 4, 3));

    expect(wrapped.rows[1]?.line.isWrapped).toBe(true);
    expect(erased.rows[0]?.line.translateToString(true)).toBe("");
    term.dispose();
  });

  it("keeps selection coordinates attached to retained parsed lines during prepend", () => {
    const term = new Terminal({ cols: 8, rows: 3 });
    const host = document.createElement("div");
    document.body.appendChild(host);
    term.open(host);
    const adapter = new TerminalParsedBufferAdapter(term);
    const newer = adapter.parse(viewport("one\ntwo\nthree"));
    adapter.install(newer.rows, 0, { x: 0, y: 2, restore: "" });
    term.select(0, 1, 3);
    expect(term.getSelection()).toBe("two");

    const older = adapter.parse(viewport("old1\nold2\nold3"));
    adapter.install([...older.rows, ...newer.rows], 3, { x: 0, y: 2, restore: "" });
    expect(term.getSelection()).toBe("two");
    expect(term.getSelectionPosition()?.start.y).toBe(4);
    term.dispose();
  });

  it("clears a selection when eviction removes either selected boundary line", () => {
    const term = new Terminal({ cols: 8, rows: 3 });
    const host = document.createElement("div");
    document.body.appendChild(host);
    term.open(host);
    const adapter = new TerminalParsedBufferAdapter(term);
    const parsed = adapter.parse(viewport("one\ntwo\nthree"));
    adapter.install(parsed.rows, 0, { x: 0, y: 2, restore: "" });
    term.select(0, 0, 11);
    expect(term.hasSelection()).toBe(true);

    adapter.install(parsed.rows.slice(1), 0, { x: 0, y: 1, restore: "" });

    expect(term.hasSelection()).toBe(false);
    term.dispose();
  });
});
