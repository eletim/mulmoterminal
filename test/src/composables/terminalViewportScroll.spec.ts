import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import {
  boundedScrollCell,
  boundedViewportRows,
  scrollSelectionEdge,
  takeScrollChunk,
  viewportRenderData,
  wireGenericWheel,
  type GenericScrollIntent,
} from "../../../src/composables/terminalViewportScroll";

beforeAll(() => {
  window.matchMedia ??= () => ({ addListener() {}, removeListener() {} }) as unknown as MediaQueryList;
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const terminals: Terminal[] = [];

afterEach(() => {
  terminals.splice(0).forEach((term) => term.dispose());
  document.body.replaceChildren();
});

function wired(enabled = true) {
  const term = new Terminal({ cols: 80, rows: 24 });
  terminals.push(term);
  const host = document.createElement("div");
  document.body.appendChild(host);
  term.open(host);
  const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) throw new Error("missing terminal screen");
  screen.getBoundingClientRect = () => new DOMRect(0, 0, 800, 480);
  const intents: GenericScrollIntent[] = [];
  wireGenericWheel(
    term,
    () => enabled,
    () => 1,
    (intent) => intents.push(intent),
  );
  return { screen, intents };
}

describe("wireGenericWheel", () => {
  it("sends terminal-level rows and cell coordinates without mouse protocol bytes", () => {
    const { screen, intents } = wired();
    screen.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, clientX: 115, clientY: 250, bubbles: true, cancelable: true }));
    expect(intents).toEqual([{ direction: "up", lines: 6, cell: { column: 12, row: 13 } }]);
    expect(JSON.stringify(intents)).not.toContain("\\u001b");
  });

  it("leaves non-persistent command terminals to xterm", () => {
    const { screen, intents } = wired(false);
    expect(screen.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }))).toBe(true);
    expect(intents).toEqual([]);
  });
});

describe("scrollSelectionEdge", () => {
  it("keeps selection edge scrolling inside a command terminal's xterm scrollback", () => {
    const term = new Terminal({ cols: 80, rows: 24 });
    terminals.push(term);
    const send = vi.fn(() => false);
    const scrollLines = vi.spyOn(term, "scrollLines");

    expect(scrollSelectionEdge(term, false, -3, send)).toBe(true);
    expect(scrollLines).toHaveBeenCalledWith(-3);
    expect(send).not.toHaveBeenCalled();
  });

  it("routes persistent selection edge scrolling through the generic Core intent", () => {
    const term = new Terminal({ cols: 80, rows: 24 });
    terminals.push(term);
    const send = vi.fn(() => true);
    const scrollLines = vi.spyOn(term, "scrollLines");

    expect(scrollSelectionEdge(term, true, 2, send)).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(scrollLines).not.toHaveBeenCalled();
  });
});

describe("viewportRenderData", () => {
  it("replaces the visible screen and preserves ANSI content", () => {
    expect(viewportRenderData("\x1b[31mred\x1b[0m\nnext\n")).toBe("\x1b[H\x1b[2J\x1b[31mred\x1b[0m\r\nnext");
  });

  it("restores the target terminal buffer before clearing and drawing it", () => {
    const restore = "\x1b[?1049l\x1b[?1003l";
    expect(viewportRenderData("shell", restore)).toBe(`${restore}\x1b[H\x1b[2Jshell`);
  });
});

describe("takeScrollChunk", () => {
  it("splits queued movement into protocol-safe chunks without losing direction or rows", () => {
    expect(takeScrollChunk(275)).toEqual({ lines: 200, remaining: 75 });
    expect(takeScrollChunk(-275)).toEqual({ lines: -200, remaining: -75 });
    expect(takeScrollChunk(75)).toEqual({ lines: 75, remaining: 0 });
  });
});

describe("boundedViewportRows", () => {
  it("keeps viewport and scroll requests inside the shared wire bounds", () => {
    expect(boundedViewportRows(24)).toBe(24);
    expect(boundedViewportRows(250)).toBe(200);
    expect(boundedViewportRows(1)).toBe(1);
  });
});

describe("boundedScrollCell", () => {
  it("keeps pointer coordinates inside the scroll protocol bounds", () => {
    expect(boundedScrollCell({ col: 12, row: 8 })).toEqual({ column: 12, row: 8 });
    expect(boundedScrollCell({ col: 999, row: 250 })).toEqual({ column: 500, row: 200 });
    expect(boundedScrollCell({ col: 0, row: -4 })).toEqual({ column: 1, row: 1 });
  });
});
