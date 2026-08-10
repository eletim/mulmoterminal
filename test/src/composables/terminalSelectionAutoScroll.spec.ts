import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireSelectionEdgeAutoScroll } from "../../../src/composables/terminalSelectionAutoScroll";

function makeTerminal(mouseTrackingMode = "none") {
  const host = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  host.appendChild(screen);
  document.body.appendChild(host);
  screen.getBoundingClientRect = () => new DOMRect(40, 100, 800, 240);
  const term = {
    element: host,
    modes: { mouseTrackingMode },
    options: { macOptionClickForcesSelection: true },
  };
  return { term, screen };
}

function mouse(type: "mousedown" | "mousemove" | "mouseup", clientY: number, options: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1,
    ...options,
  });
}

describe("wireSelectionEdgeAutoScroll", () => {
  let raf: FrameRequestCallback | null = null;
  let rafId = 0;
  const syntheticMoves: number[] = [];
  const onDocumentMove = (event: MouseEvent): void => {
    if (event.clientY < 100 || event.clientY > 340) syntheticMoves.push(event.clientY);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      raf = cb;
      return ++rafId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      if (id === rafId) raf = null;
    });
    document.addEventListener("mousemove", onDocumentMove);
  });

  afterEach(() => {
    document.removeEventListener("mousemove", onDocumentMove);
    document.body.replaceChildren();
    syntheticMoves.length = 0;
    raf = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function flushRaf(): void {
    const cb = raf;
    raf = null;
    cb?.(performance.now());
  }

  it("hands top-edge drags to xterm's existing outside-viewport drag scroll", () => {
    const { term, screen } = makeTerminal();
    const handle = wireSelectionEdgeAutoScroll(term);
    screen.dispatchEvent(mouse("mousedown", 140));
    vi.runOnlyPendingTimers();

    document.dispatchEvent(mouse("mousemove", 104));
    flushRaf();

    expect(syntheticMoves).toHaveLength(1);
    expect(syntheticMoves[0]).toBeLessThan(100);
    handle?.dispose();
  });

  it("hands bottom-edge drags to xterm's existing outside-viewport drag scroll", () => {
    const { term, screen } = makeTerminal();
    const handle = wireSelectionEdgeAutoScroll(term);
    screen.dispatchEvent(mouse("mousedown", 140));
    vi.runOnlyPendingTimers();

    document.dispatchEvent(mouse("mousemove", 336));
    flushRaf();

    expect(syntheticMoves).toHaveLength(1);
    expect(syntheticMoves[0]).toBeGreaterThan(340);
    handle?.dispose();
  });

  it("does nothing for mousemove when no selection drag is active", () => {
    const { term } = makeTerminal();
    const handle = wireSelectionEdgeAutoScroll(term);

    document.dispatchEvent(mouse("mousemove", 104));
    flushRaf();

    expect(syntheticMoves).toEqual([]);
    handle?.dispose();
  });

  it("stops once the pointer leaves the edge band", () => {
    const { term, screen } = makeTerminal();
    const handle = wireSelectionEdgeAutoScroll(term);
    screen.dispatchEvent(mouse("mousedown", 140));
    vi.runOnlyPendingTimers();

    document.dispatchEvent(mouse("mousemove", 104));
    document.dispatchEvent(mouse("mousemove", 180));
    flushRaf();

    expect(syntheticMoves).toEqual([]);
    handle?.dispose();
  });

  it("stops on mouseup before a pending edge move fires", () => {
    const { term, screen } = makeTerminal();
    const handle = wireSelectionEdgeAutoScroll(term);
    screen.dispatchEvent(mouse("mousedown", 140));
    vi.runOnlyPendingTimers();

    document.dispatchEvent(mouse("mousemove", 104));
    document.dispatchEvent(mouse("mouseup", 104));
    flushRaf();

    expect(syntheticMoves).toEqual([]);
    handle?.dispose();
  });

  it("does not arm stale listeners when mouseup follows mousedown immediately", () => {
    const { term, screen } = makeTerminal();
    const handle = wireSelectionEdgeAutoScroll(term);

    screen.dispatchEvent(mouse("mousedown", 140));
    document.dispatchEvent(mouse("mouseup", 140));
    vi.runOnlyPendingTimers();
    document.dispatchEvent(mouse("mousemove", 104));
    flushRaf();

    expect(syntheticMoves).toEqual([]);
    handle?.dispose();
  });

  it("does not queue duplicate animation frames for repeated edge moves", () => {
    const requestAnimationFrame = vi.mocked(window.requestAnimationFrame);
    const { term, screen } = makeTerminal();
    const handle = wireSelectionEdgeAutoScroll(term);
    screen.dispatchEvent(mouse("mousedown", 140));
    vi.runOnlyPendingTimers();

    document.dispatchEvent(mouse("mousemove", 104));
    document.dispatchEvent(mouse("mousemove", 105));
    document.dispatchEvent(mouse("mousemove", 106));

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    handle?.dispose();
  });

  it("cleans active document listeners and pending frames on dispose", () => {
    const { term, screen } = makeTerminal();
    const handle = wireSelectionEdgeAutoScroll(term);
    screen.dispatchEvent(mouse("mousedown", 140));
    vi.runOnlyPendingTimers();
    document.dispatchEvent(mouse("mousemove", 104));

    handle?.dispose();
    flushRaf();
    document.dispatchEvent(mouse("mousemove", 104));
    flushRaf();

    expect(syntheticMoves).toEqual([]);
  });

  it("does not intervene in real xterm mouse-reporting mode unless the gesture forces selection", () => {
    const { term, screen } = makeTerminal("drag");
    const handle = wireSelectionEdgeAutoScroll(term);

    screen.dispatchEvent(mouse("mousedown", 140));
    vi.runOnlyPendingTimers();
    document.dispatchEvent(mouse("mousemove", 104));
    flushRaf();
    expect(syntheticMoves).toEqual([]);

    screen.dispatchEvent(mouse("mousedown", 140, { shiftKey: true }));
    vi.runOnlyPendingTimers();
    document.dispatchEvent(mouse("mousemove", 104, { shiftKey: true }));
    flushRaf();
    expect(syntheticMoves).toHaveLength(1);
    handle?.dispose();
  });

  it("does not treat Alt as forced selection outside macOS", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    const { term, screen } = makeTerminal("drag");
    const handle = wireSelectionEdgeAutoScroll(term);

    screen.dispatchEvent(mouse("mousedown", 140, { altKey: true }));
    vi.runOnlyPendingTimers();
    document.dispatchEvent(mouse("mousemove", 104, { altKey: true }));
    flushRaf();

    expect(syntheticMoves).toEqual([]);
    handle?.dispose();
  });

  it("uses Option, not Shift, as forced selection on macOS", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const { term, screen } = makeTerminal("drag");
    const handle = wireSelectionEdgeAutoScroll(term);

    screen.dispatchEvent(mouse("mousedown", 140, { shiftKey: true }));
    vi.runOnlyPendingTimers();
    document.dispatchEvent(mouse("mousemove", 104, { shiftKey: true }));
    flushRaf();
    expect(syntheticMoves).toEqual([]);

    screen.dispatchEvent(mouse("mousedown", 140, { altKey: true }));
    vi.runOnlyPendingTimers();
    document.dispatchEvent(mouse("mousemove", 104, { altKey: true }));
    flushRaf();
    expect(syntheticMoves).toHaveLength(1);
    handle?.dispose();
  });
});
