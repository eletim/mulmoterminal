import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { takeScrollChunk, viewportRenderData, wireGenericWheel, type GenericScrollIntent } from "../../../src/composables/terminalViewportScroll";

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
