import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { wireSelectionEdgeAutoScroll } from "../../../src/composables/terminalSelectionAutoScroll";

const RECT = new DOMRect(40, 100, 800, 240);

interface FakeTerm {
  element: HTMLElement;
  cols: number;
  rows: number;
  modes: { mouseTrackingMode: string };
  options: { macOptionClickForcesSelection: boolean };
  buffer: { active: { type: "normal" | "alternate"; viewportY: number; baseY: number } };
  input: ReturnType<typeof vi.fn>;
  scrollLines: ReturnType<typeof vi.fn>;
}

function makeTerminal(options: { bufferType?: "normal" | "alternate"; viewportY?: number; baseY?: number; mouseTrackingMode?: string } = {}) {
  const host = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  host.appendChild(screen);
  document.body.appendChild(host);
  screen.getBoundingClientRect = () => RECT;

  const term: FakeTerm = {
    element: host,
    cols: 80,
    rows: 24,
    modes: { mouseTrackingMode: options.mouseTrackingMode ?? "none" },
    options: { macOptionClickForcesSelection: true },
    buffer: { active: { type: options.bufferType ?? "normal", viewportY: options.viewportY ?? 100, baseY: options.baseY ?? 200 } },
    input: vi.fn(),
    scrollLines: vi.fn((lines: number) => {
      const active = term.buffer.active;
      active.viewportY = Math.min(active.baseY, Math.max(0, active.viewportY + lines));
    }),
  };

  return { term, screen };
}

function mouse(type: "mousedown" | "mousemove" | "mouseup", clientY: number, options: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY,
    button: MAIN_BUTTON,
    buttons: type === "mouseup" ? 0 : 1,
    ...options,
  });
}

const MAIN_BUTTON = 0;
const TRACKING_MODES = new Set([1002, 1006]);
const wire = (term: FakeTerm, modes: ReadonlySet<number>) => wireSelectionEdgeAutoScroll(term as unknown as Terminal, modes);

describe("wireSelectionEdgeAutoScroll", () => {
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();

  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frameId += 1;
      frames.set(frameId, cb);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    frames.clear();
    frameId = 0;
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  function flushFrame(now = 80): void {
    const [id, cb] = frames.entries().next().value ?? [];
    if (id === undefined || !cb) return;
    frames.delete(id);
    cb(now);
  }

  function dragToEdge(screen: HTMLElement, clientY: number): void {
    screen.dispatchEvent(mouse("mousedown", 180));
    document.dispatchEvent(mouse("mousemove", clientY));
  }

  it("scrolls up through the existing normal-buffer UI scroll path while dragging at the top edge", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    flushFrame(80);

    expect(term.scrollLines).toHaveBeenCalledWith(-1);
    expect(term.buffer.active.viewportY).toBe(49);
    handle?.dispose();
  });

  it("scrolls down through the existing normal-buffer UI scroll path while dragging at the bottom edge", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.bottom - 4);
    flushFrame(0);
    flushFrame(80);

    expect(term.scrollLines).toHaveBeenCalledWith(1);
    expect(term.buffer.active.viewportY).toBe(51);
    handle?.dispose();
  });

  it("updates xterm's in-viewport selection endpoint after an auto-scroll tick", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const handle = wire(term, new Set());
    const moves: number[] = [];
    screen.addEventListener("mousemove", (event) => moves.push(event.clientY));

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    flushFrame(80);

    expect(moves).toEqual([RECT.top + 4]);
    handle?.dispose();
  });

  it("stops once the pointer leaves the edge band", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.top + 4);
    document.dispatchEvent(mouse("mousemove", RECT.top + 80));
    flushFrame(80);

    expect(term.scrollLines).not.toHaveBeenCalled();
    handle?.dispose();
  });

  it("stops on mouseup before a pending frame scrolls", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.top + 4);
    document.dispatchEvent(mouse("mouseup", RECT.top + 4));
    flushFrame(80);

    expect(term.scrollLines).not.toHaveBeenCalled();
    handle?.dispose();
  });

  it("does nothing for mousemove when no selection drag is active", () => {
    const { term } = makeTerminal({ viewportY: 50 });
    const handle = wire(term, new Set());

    document.dispatchEvent(mouse("mousemove", RECT.top + 4));
    flushFrame(80);

    expect(term.scrollLines).not.toHaveBeenCalled();
    handle?.dispose();
  });

  it("does not start auto-scroll for a click that has not become a drag", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const handle = wire(term, new Set());

    screen.dispatchEvent(mouse("mousedown", RECT.top + 2));
    document.dispatchEvent(mouse("mousemove", RECT.top + 1, { clientX: 121 }));
    flushFrame(80);

    expect(term.scrollLines).not.toHaveBeenCalled();
    handle?.dispose();
  });

  it("does not queue duplicate animation frames for repeated edge moves", () => {
    const requestAnimationFrame = vi.mocked(window.requestAnimationFrame);
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const handle = wire(term, new Set());

    screen.dispatchEvent(mouse("mousedown", 180));
    document.dispatchEvent(mouse("mousemove", RECT.top + 4));
    document.dispatchEvent(mouse("mousemove", RECT.top + 5));
    document.dispatchEvent(mouse("mousemove", RECT.top + 6));

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    handle?.dispose();
  });

  it("does not keep looping at the scrollback limit", () => {
    const requestAnimationFrame = vi.mocked(window.requestAnimationFrame);
    const { term, screen } = makeTerminal({ viewportY: 0 });
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    flushFrame(80);
    flushFrame(160);

    expect(term.scrollLines).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    handle?.dispose();
  });

  it("cleans document listeners and pending frames on dispose", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.top + 4);
    handle?.dispose();
    flushFrame(80);
    document.dispatchEvent(mouse("mousemove", RECT.top + 4));
    flushFrame(160);

    expect(term.scrollLines).not.toHaveBeenCalled();
  });

  it("reuses the existing alternate-buffer wheel report path instead of scrollLines", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate" });
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.bottom - 4);
    flushFrame(0);
    flushFrame(80);

    expect(term.scrollLines).not.toHaveBeenCalled();
    expect(term.input).toHaveBeenCalledWith("\x1b[<65;9;24M", false);
    handle?.dispose();
  });

  it("does not intervene when xterm owns mouse reporting and the gesture does not force selection", () => {
    const { term, screen } = makeTerminal({ mouseTrackingMode: "drag", viewportY: 50 });
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    flushFrame(80);

    expect(term.scrollLines).not.toHaveBeenCalled();
    handle?.dispose();
  });
});
