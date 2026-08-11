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
  input: (data: string, wasUserInput?: boolean) => void;
  scrollLines: (lines: number) => void;
  hasSelection: () => boolean;
  getSelection: () => string;
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
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
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
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();

function installFrameMocks(): void {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frameId += 1;
    frames.set(frameId, cb);
    return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
}

function clearFrameMocks(): void {
  frames.clear();
  frameId = 0;
  vi.restoreAllMocks();
}

function flushFrame(now = 80): void {
  const [id, cb] = frames.entries().next().value ?? [];
  if (id === undefined || !cb) return;
  frames.delete(id);
  cb(now);
}

function selectionRowFor(event: MouseEvent, term: FakeTerm, screen: HTMLElement): number {
  const rect = screen.getBoundingClientRect();
  const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height - 1);
  const row = Math.floor((y / rect.height) * term.rows);
  return term.buffer.active.viewportY + row;
}

function installXtermSelectionDrag(term: FakeTerm, screen: HTMLElement) {
  const state = {
    selectionStart: null as number | null,
    selectionEnd: null as number | null,
    documentMoves: [] as number[],
    dragScrollRequests: [] as number[],
  };
  let active = false;
  const onMove = (event: MouseEvent): void => {
    if (!active) return;
    state.documentMoves.push(event.clientY);
    state.selectionEnd = selectionRowFor(event, term, screen);
    const rect = screen.getBoundingClientRect();
    if (event.clientY < rect.top && term.buffer.active.viewportY > 0) {
      state.dragScrollRequests.push(-1);
      term.scrollLines(-1);
      state.selectionEnd = term.buffer.active.viewportY;
    } else if (event.clientY > rect.bottom && term.buffer.active.viewportY < term.buffer.active.baseY) {
      state.dragScrollRequests.push(1);
      term.scrollLines(1);
      state.selectionEnd = term.buffer.active.viewportY + term.rows;
    }
  };
  const onUp = (): void => {
    active = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  term.element.addEventListener("mousedown", (event) => {
    if (event.button !== MAIN_BUTTON) return;
    active = true;
    state.selectionStart = selectionRowFor(event, term, screen);
    state.selectionEnd = state.selectionStart;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
  return state;
}

describe("wireSelectionEdgeAutoScroll", () => {
  beforeEach(() => {
    installFrameMocks();
  });

  afterEach(() => {
    clearFrameMocks();
    document.body.replaceChildren();
  });

  function dragToEdge(screen: HTMLElement, clientY: number): void {
    screen.dispatchEvent(mouse("mousedown", 180));
    document.dispatchEvent(mouse("mousemove", clientY));
  }

  it("scrolls up through the existing normal-buffer UI scroll path while dragging at the top edge", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const selection = installXtermSelectionDrag(term, screen);
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    flushFrame(80);

    expect(term.scrollLines).toHaveBeenCalledWith(-1);
    expect(selection.dragScrollRequests).toEqual([-1, -1]);
    expect(term.buffer.active.viewportY).toBe(48);
    handle?.dispose();
  });

  it("scrolls down through the existing normal-buffer UI scroll path while dragging at the bottom edge", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const selection = installXtermSelectionDrag(term, screen);
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.bottom - 4);
    flushFrame(0);
    flushFrame(80);

    expect(term.scrollLines).toHaveBeenCalledWith(1);
    expect(selection.dragScrollRequests).toEqual([1, 1]);
    expect(term.buffer.active.viewportY).toBe(52);
    handle?.dispose();
  });

  it("drives xterm's document-level selection listener with an offscreen move in normal buffer", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    installXtermSelectionDrag(term, screen);
    const handle = wire(term, new Set());
    const moves: number[] = [];

    dragToEdge(screen, RECT.top + 4);
    document.addEventListener("mousemove", (event) => moves.push(event.clientY));
    flushFrame(0);
    flushFrame(80);

    expect(moves).toHaveLength(2);
    expect(moves[0]).toBeLessThan(RECT.top);
    expect(moves[1]).toBeLessThan(RECT.top);
    handle?.dispose();
  });

  it("lets xterm extend the selection endpoint into newly revealed rows after scrolling upward", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const selection = installXtermSelectionDrag(term, screen);
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.top + 4);
    const before = selection.selectionEnd;
    flushFrame(0);
    flushFrame(80);

    expect(term.scrollLines).toHaveBeenCalledWith(-1);
    expect(before).toBe(50);
    expect(selection.selectionEnd).toBe(48);
    handle?.dispose();
  });

  it("lets xterm extend the selection endpoint into newly revealed rows after scrolling downward", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const selection = installXtermSelectionDrag(term, screen);
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.bottom - 4);
    const before = selection.selectionEnd;
    flushFrame(0);
    flushFrame(80);

    expect(term.scrollLines).toHaveBeenCalledWith(1);
    expect(before).toBe(73);
    expect(selection.selectionEnd).toBe(76);
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
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
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
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockReturnValue("990");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.bottom - 4);
    flushFrame(0);
    flushFrame(80);

    expect(term.scrollLines).not.toHaveBeenCalled();
    expect(term.input).toHaveBeenCalledWith("\x1b[<65;9;24M", false);
    handle?.dispose();
  });

  it("copies the accumulated alternate-buffer selection text after app-side scrollback redraws", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate" });
    const selections = ["970\n971\n972", "960\n961\n962\n970\n971\n972", "950\n951\n960\n961\n962\n970\n971\n972"];
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockImplementation(() => selections[0] ?? "");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    selections.shift();
    flushFrame(80);
    selections.shift();
    document.dispatchEvent(mouse("mouseup", RECT.top + 4));

    let copied = term.getSelection();
    const copyEvent = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(copyEvent, "clipboardData", {
      value: {
        setData: (_type: string, value: string) => {
          copied = value;
        },
      },
    });
    screen.parentElement?.dispatchEvent(copyEvent);

    expect(copied).toBe(["950", "951", "960", "961", "962", "970", "971", "972"].join("\n"));
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
