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
  buffer: {
    active: { type: "normal" | "alternate"; viewportY: number; baseY: number; getLine: (row: number) => { translateToString: () => string } | undefined };
  };
  input: (data: string, wasUserInput?: boolean) => void;
  genericScroll: (lines: number) => void;
  scrollLines: (lines: number) => void;
  hasSelection: () => boolean;
  getSelection: () => string;
  _core?: {
    _selectionService?: {
      _model?: { selectionStart?: [number, number]; selectionEnd?: [number, number] };
      refresh?: () => void;
    };
  };
}

function makeTerminal(options: { bufferType?: "normal" | "alternate"; viewportY?: number; baseY?: number; mouseTrackingMode?: string } = {}) {
  const host = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  host.appendChild(screen);
  document.body.appendChild(host);
  screen.getBoundingClientRect = () => RECT;

  const visibleLines = Array.from({ length: 240 }, (_value, index) => `line-${index}`);
  const term: FakeTerm = {
    element: host,
    cols: 80,
    rows: 24,
    modes: { mouseTrackingMode: options.mouseTrackingMode ?? "none" },
    options: { macOptionClickForcesSelection: true },
    buffer: {
      active: {
        type: options.bufferType ?? "normal",
        viewportY: options.viewportY ?? 100,
        baseY: options.baseY ?? 200,
        getLine: (row: number) => {
          const text = visibleLines[row];
          return text === undefined ? undefined : { translateToString: () => text };
        },
      },
    },
    input: vi.fn(),
    genericScroll: vi.fn(),
    scrollLines: vi.fn((lines: number) => {
      const active = term.buffer.active;
      active.viewportY = Math.min(active.baseY, Math.max(0, active.viewportY + lines));
    }),
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
  };

  return { term, screen, visibleLines };
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
// Kept in the call shape so the former mouse-mode matrix still exercises the same cases; Core now
// owns scroll routing, so the browser callback intentionally ignores those modes.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const wire = (term: FakeTerm, _modes: ReadonlySet<number>) =>
  wireSelectionEdgeAutoScroll(term as unknown as Terminal, (lines) => {
    term.genericScroll(lines);
    if (term.buffer.active.type === "normal") {
      if ((lines < 0 && term.buffer.active.viewportY === 0) || (lines > 0 && term.buffer.active.viewportY === term.buffer.active.baseY)) return false;
      term.scrollLines(lines);
    } else term.input("generic-scroll", false);
    return true;
  });
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

function installXtermSelectionModel(term: FakeTerm, selectionStart: [number, number], selectionEnd: [number, number]) {
  const model = { selectionStart, selectionEnd };
  const refresh = vi.fn();
  term._core = { _selectionService: { _model: model, refresh } };
  return { model, refresh };
}

function shiftVisibleLines(lines: string[], direction: "up" | "down"): void {
  if (direction === "down") {
    lines.pop();
    lines.unshift(`new-top-${Date.now()}`);
    return;
  }
  lines.shift();
  lines.push(`new-bottom-${Date.now()}`);
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
    expect(selection.dragScrollRequests).toEqual([]);
    expect(term.buffer.active.viewportY).toBe(49);
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
    expect(selection.dragScrollRequests).toEqual([]);
    expect(term.buffer.active.viewportY).toBe(51);
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

    expect(moves).toHaveLength(1);
    expect(moves[0]).toBeGreaterThanOrEqual(RECT.top);
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
    expect(selection.selectionEnd).toBe(49);
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
    expect(selection.selectionEnd).toBe(74);
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

  it("keeps auto-scrolling when a descendant mouseleave fires during an outside-edge drag", () => {
    const { term, screen } = makeTerminal({ viewportY: 50 });
    const canvas = document.createElement("canvas");
    screen.appendChild(canvas);
    installXtermSelectionDrag(term, screen);
    const handle = wire(term, new Set());

    dragToEdge(screen, RECT.top + 4);
    canvas.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: true, buttons: 1 }));
    flushFrame(0);
    flushFrame(80);

    expect(term.scrollLines).toHaveBeenCalledWith(-1);
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

  it("routes alternate-buffer selection scroll through generic Core intent instead of scrollLines", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate", viewportY: 0, baseY: 0 });
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockReturnValue("990");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.bottom - 4);
    flushFrame(0);
    flushFrame(80);
    flushFrame(160);

    expect(term.scrollLines).not.toHaveBeenCalled();
    expect(term.genericScroll).toHaveBeenCalledWith(1);
    handle?.dispose();
  });

  it("moves the alternate-buffer selection anchor with app-side upward scroll redraws", () => {
    const { term, screen, visibleLines } = makeTerminal({ bufferType: "alternate", viewportY: 0, baseY: 0 });
    const selection = installXtermSelectionModel(term, [10, 12], [4, 0]);
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockReturnValue("970\n971\n972");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    flushFrame(80);
    shiftVisibleLines(visibleLines, "down");
    flushFrame(160);

    expect(selection.model.selectionStart).toEqual([10, 13]);
    expect(selection.refresh).toHaveBeenCalled();
    handle?.dispose();
  });

  it("moves the alternate-buffer selection anchor with app-side downward scroll redraws", () => {
    const { term, screen, visibleLines } = makeTerminal({ bufferType: "alternate", viewportY: 0, baseY: 0 });
    const selection = installXtermSelectionModel(term, [10, 12], [80, 23]);
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockReturnValue("970\n971\n972");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.bottom - 4);
    flushFrame(0);
    flushFrame(80);
    shiftVisibleLines(visibleLines, "up");
    flushFrame(160);

    expect(selection.model.selectionStart).toEqual([10, 11]);
    expect(selection.refresh).toHaveBeenCalled();
    handle?.dispose();
  });

  it("clips an alternate-buffer selection anchor that scrolls beyond the visible buffer", () => {
    const { term, screen, visibleLines } = makeTerminal({ bufferType: "alternate", viewportY: 0, baseY: 0 });
    const selection = installXtermSelectionModel(term, [10, 23], [4, 0]);
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockReturnValue("970\n971\n972");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    flushFrame(80);
    shiftVisibleLines(visibleLines, "down");
    flushFrame(160);

    expect(selection.model.selectionStart).toEqual([80, 23]);
    handle?.dispose();
  });

  it("does not move the alternate-buffer anchor when application scroll does not move content", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate", viewportY: 0, baseY: 0 });
    const selection = installXtermSelectionModel(term, [10, 12], [4, 0]);
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockReturnValue("970\n971\n972");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    flushFrame(80);
    flushFrame(160);

    expect(selection.model.selectionStart).toEqual([10, 12]);
    expect(selection.refresh).not.toHaveBeenCalled();
    handle?.dispose();
  });

  it("applies an observed app-side scroll before the final mouseup capture", () => {
    const { term, screen, visibleLines } = makeTerminal({ bufferType: "alternate", viewportY: 0, baseY: 0 });
    const selection = installXtermSelectionModel(term, [10, 12], [4, 0]);
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockReturnValue("970\n971\n972");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    flushFrame(80);
    shiftVisibleLines(visibleLines, "down");
    document.dispatchEvent(mouse("mouseup", RECT.top + 4));

    expect(selection.model.selectionStart).toEqual([10, 13]);
    expect(selection.refresh).toHaveBeenCalled();
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

  it("deduplicates long clipped overlap lines while accumulating copied text", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate" });
    const fullFirstLine =
      "packages/training-data/dist/generatePlayingSelfPlayDataset.d.ts:22:export declare const COMPLETE_INFO_COMPACT_PLAYING_OBSERVATION_VARIANT";
    const clippedFirstLine = fullFirstLine.slice(3);
    const secondLine = "packages/training-data/dist/generatePlayingSelfPlayDataset.js:26:export const COMPLETE_INFO_COMPACT_PLAYING_OBSERVATION_VARIANT";
    const thirdLine = "packages/training-data/src/generatePlayingSelfPlayDataset.ts:63:export const COMPLETE_INFO_COMPACT_PLAYING_OBSERVATION_VARIANT";
    const newLine = 'apps/self-play-cli/dist/playingSelfPlayCli.js:236:    if (value === "public" || value === "complete-info-compact")';
    const selections = [[fullFirstLine, secondLine, thirdLine].join("\n"), [newLine, clippedFirstLine, secondLine, thirdLine].join("\n")];
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockImplementation(() => selections[0] ?? "");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    flushFrame(80);
    selections.shift();
    document.dispatchEvent(mouse("mouseup", RECT.top + 4));

    expect(handle?.selectionTextForCopy()).toBe([newLine, fullFirstLine, secondLine, thirdLine].join("\n"));
    handle?.dispose();
  });

  it("unions shifted visible selection windows while accumulating copied text", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate" });
    const selections = [
      ["241", "242", "243", "244", "245"].join("\n"),
      ["239", "240", "241", "242", "243", "244", "245", "246"].join("\n"),
      ["240", "241", "242", "243", "244", "245", "246", "247"].join("\n"),
    ];
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockImplementation(() => selections[0] ?? "");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    selections.shift();
    flushFrame(80);
    selections.shift();
    flushFrame(160);
    document.dispatchEvent(mouse("mouseup", RECT.top + 4));

    expect(handle?.selectionTextForCopy()).toBe(["239", "240", "241", "242", "243", "244", "245", "246", "247"].join("\n"));
    handle?.dispose();
  });

  it("ignores tmux scroll-position overlays while merging shifted selection windows", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate" });
    const selections = [
      ["241                                                                    [727/965]", "242", "243", "244", "245"].join("\n"),
      ["[728/965]", "239", "240", "241", "242", "243", "244", "245", "246"].join("\n"),
      ["[729/965]", "240", "241", "242", "243", "244", "245", "246", "247"].join("\n"),
    ];
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockImplementation(() => selections[0] ?? "");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    selections.shift();
    flushFrame(80);
    selections.shift();
    flushFrame(160);
    document.dispatchEvent(mouse("mouseup", RECT.top + 4));

    expect(handle?.selectionTextForCopy()).toBe(["239", "240", "241", "242", "243", "244", "245", "246", "247"].join("\n"));
    handle?.dispose();
  });

  it("preserves blank lines inside accumulated alternate-buffer copied text", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate" });
    const selections = ["970\n\n972", "960\n\n962\n970\n\n972", "950\n\n960\n\n962\n970\n\n972"];
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

    expect(copied).toBe(["950", "", "960", "", "962", "970", "", "972"].join("\n"));
    handle?.dispose();
  });

  it("keeps accumulated alternate-buffer text when the pointer leaves the edge band before mouseup", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate" });
    const selections = ["970\n971\n972", "960\n961\n962\n970\n971\n972", "950\n951\n960\n961\n962"];
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockImplementation(() => selections[0] ?? "");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    selections.shift();
    flushFrame(80);
    selections.shift();
    document.dispatchEvent(mouse("mousemove", RECT.top + 80));
    document.dispatchEvent(mouse("mouseup", RECT.top + 80));

    expect(handle?.selectionTextForCopy()).toBe(["950", "951", "960", "961", "962", "970", "971", "972"].join("\n"));
    handle?.dispose();
  });

  it("copies accumulated text from a browser copy event dispatched on xterm's helper textarea", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate" });
    const textarea = document.createElement("textarea");
    textarea.className = "xterm-helper-textarea";
    screen.parentElement?.appendChild(textarea);
    const selections = ["970\n971\n972", "960\n961\n962\n970\n971\n972", "950\n951\n960\n961\n962"];
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockImplementation(() => selections[0] ?? "");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    selections.shift();
    flushFrame(80);
    selections.shift();
    document.dispatchEvent(mouse("mouseup", RECT.top + 4));

    let copied = "";
    const copyEvent = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(copyEvent, "clipboardData", {
      value: {
        setData: (_type: string, value: string) => {
          copied = value;
        },
      },
    });
    textarea.dispatchEvent(copyEvent);

    expect(copied).toBe(["950", "951", "960", "961", "962", "970", "971", "972"].join("\n"));
    expect(copyEvent.defaultPrevented).toBe(true);
    handle?.dispose();
  });

  it("copies accumulated alternate-buffer selection text in downward order", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate" });
    const selections = ["200\n201\n202", "200\n201\n202\n210\n211\n212", "210\n211\n212\n220\n221"];
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockImplementation(() => selections[0] ?? "");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.bottom - 4);
    flushFrame(0);
    selections.shift();
    flushFrame(80);
    selections.shift();
    document.dispatchEvent(mouse("mousemove", RECT.bottom - 80));
    document.dispatchEvent(mouse("mouseup", RECT.bottom - 80));

    expect(handle?.selectionTextForCopy()).toBe(["200", "201", "202", "210", "211", "212", "220", "221"].join("\n"));
    handle?.dispose();
  });

  it("drops accumulated alternate-buffer text when the drag reverses direction", () => {
    const { term, screen } = makeTerminal({ bufferType: "alternate" });
    const selections = ["970\n971\n972", "960\n961\n962\n970\n971\n972", "980\n981\n982"];
    vi.mocked(term.hasSelection).mockReturnValue(true);
    vi.mocked(term.getSelection).mockImplementation(() => selections[0] ?? "");
    const handle = wire(term, TRACKING_MODES);

    dragToEdge(screen, RECT.top + 4);
    flushFrame(0);
    selections.shift();
    flushFrame(80);
    selections.shift();
    document.dispatchEvent(mouse("mousemove", RECT.bottom - 4));
    flushFrame(160);

    expect(handle?.selectionTextForCopy()).toBeNull();
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
