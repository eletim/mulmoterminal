import type { Terminal } from "@xterm/xterm";
import { getTerminalScrollSpeed } from "./useTerminalScrollSpeed";
import { sendWheelReportsToApp } from "./terminalMouseInput";
import type { PointerPosition } from "./mouseReports";

const EDGE_TRIGGER_PX = 28;
const MAIN_BUTTON = 0;
const MAIN_BUTTON_MASK = 1;
const DRAG_SLOP_PX = 3;
const AUTO_SCROLL_LINES_PER_SECOND = 18;
const MAX_FRAME_MS = 80;
const XTERM_DRAG_SCROLL_MAX_THRESHOLD_PX = 50;
const XTERM_DRAG_SCROLL_MIN_OUTSIDE_PX = 1;

const syntheticSelectionMoves = new WeakSet<MouseEvent>();

export interface SelectionEdgeAutoScrollHandle {
  cancel(): void;
  dispose(): void;
  selectionTextForCopy(): string | null;
}

function screenElementOf(term: Terminal): HTMLElement | null {
  return term.element?.querySelector(".xterm-screen") ?? null;
}

function isMacPlatform(): boolean {
  return navigator.userAgent.includes("Macintosh");
}

function forcesSelection(term: Terminal, event: MouseEvent): boolean {
  if (isMacPlatform()) return event.altKey && term.options.macOptionClickForcesSelection !== false;
  return event.shiftKey;
}

function xtermMouseTrackingOwnsDrag(term: Terminal, event: MouseEvent): boolean {
  return term.modes.mouseTrackingMode !== "none" && !forcesSelection(term, event);
}

function movedPastSlop(from: PointerPosition, to: PointerPosition): boolean {
  return Math.abs(to.clientX - from.clientX) > DRAG_SLOP_PX || Math.abs(to.clientY - from.clientY) > DRAG_SLOP_PX;
}

function edgeIntensity(event: MouseEvent, screen: HTMLElement): number {
  const rect = screen.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  const y = event.clientY - rect.top;
  if (y <= EDGE_TRIGGER_PX) return -Math.min(1, (EDGE_TRIGGER_PX - y) / EDGE_TRIGGER_PX);
  const bottomDistance = rect.height - y;
  if (bottomDistance <= EDGE_TRIGGER_PX) return Math.min(1, (EDGE_TRIGGER_PX - bottomDistance) / EDGE_TRIGGER_PX);
  return 0;
}

function clampPointerToScreen(event: MouseEvent, screen: HTMLElement): PointerPosition {
  const rect = screen.getBoundingClientRect();
  return {
    clientX: Math.min(Math.max(event.clientX, rect.left), rect.right),
    clientY: Math.min(Math.max(event.clientY, rect.top), rect.bottom),
  };
}

function pointerOutsideScreenForXtermDragScroll(event: MouseEvent, screen: HTMLElement, intensity: number): PointerPosition {
  const rect = screen.getBoundingClientRect();
  const pointer = clampPointerToScreen(event, screen);
  const outsidePx = Math.max(XTERM_DRAG_SCROLL_MIN_OUTSIDE_PX, Math.abs(intensity) * XTERM_DRAG_SCROLL_MAX_THRESHOLD_PX);
  return {
    clientX: pointer.clientX,
    clientY: intensity < 0 ? rect.top - outsidePx : rect.bottom + outsidePx,
  };
}

function cloneSelectionMove(event: MouseEvent, pointer: PointerPosition): MouseEvent {
  const synthetic = new MouseEvent("mousemove", {
    bubbles: true,
    cancelable: true,
    view: event.view,
    detail: event.detail,
    screenX: event.screenX,
    screenY: event.screenY,
    clientX: pointer.clientX,
    clientY: pointer.clientY,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    button: event.button,
    buttons: event.buttons,
    relatedTarget: event.relatedTarget,
  });
  syntheticSelectionMoves.add(synthetic);
  return synthetic;
}

function dispatchSelectionMove(target: Document, event: MouseEvent, pointer: PointerPosition): void {
  // xterm's SelectionService listens for drag moves on ownerDocument after mousedown.
  target.dispatchEvent(cloneSelectionMove(event, pointer));
}

function selectionLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  return lines;
}

function isAsciiDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (const char of value) {
    if (char < "0" || char > "9") return false;
  }
  return true;
}

function selectionLineKey(line: string): string {
  const trimmed = line.trim();
  const open = trimmed.lastIndexOf("[");
  if (open <= 0 || !trimmed.endsWith("]")) return trimmed;
  const position = trimmed.slice(open + 1, -1);
  const slash = position.indexOf("/");
  if (slash <= 0 || slash === position.length - 1) return trimmed;
  const before = position.slice(0, slash);
  const after = position.slice(slash + 1);
  if (!isAsciiDigits(before) || !isAsciiDigits(after)) return trimmed;
  return trimmed.slice(0, open).trimEnd();
}

function overlapSize(left: readonly string[], right: readonly string[]): number {
  const max = Math.min(left.length, right.length);
  for (let size = max; size > 0; size--) {
    let matches = true;
    for (let i = 0; i < size; i++) {
      if (selectionLineKey(left[left.length - size + i] ?? "") !== selectionLineKey(right[i] ?? "")) {
        matches = false;
        break;
      }
    }
    if (matches) return size;
  }
  return 0;
}

function mergeSelectionLines(existing: readonly string[], incoming: readonly string[], direction: number): string[] {
  if (incoming.length === 0) return [...existing];
  if (existing.length === 0) return [...incoming];
  if (direction < 0) {
    const overlap = overlapSize(incoming, existing);
    return [...incoming.slice(0, incoming.length - overlap), ...existing];
  }
  const overlap = overlapSize(existing, incoming);
  return [...existing, ...incoming.slice(overlap)];
}

function scrollbackCanMove(term: Terminal, lines: number): boolean {
  const buffer = term.buffer.active;
  if (lines < 0) return buffer.viewportY > 0;
  if (lines > 0) return buffer.viewportY < buffer.baseY;
  return false;
}

function normalBufferSelectionCanMove(term: Terminal, intensity: number): boolean {
  return scrollbackCanMove(term, intensity < 0 ? -1 : 1);
}

function scrollTerminalUi(term: Terminal, swallowedMouseModes: ReadonlySet<number>, pointer: PointerPosition, lines: number): boolean {
  if (lines === 0) return false;
  if (sendWheelReportsToApp(term, swallowedMouseModes, pointer, lines)) return true;
  if (!scrollbackCanMove(term, lines)) return false;
  const before = term.buffer.active.viewportY;
  term.scrollLines(lines);
  return term.buffer.active.viewportY !== before;
}

class SelectionEdgeAutoScroller implements SelectionEdgeAutoScrollHandle {
  private readonly term: Terminal;
  private readonly swallowedMouseModes: ReadonlySet<number>;
  private readonly screen: HTMLElement;
  private activeDocument: Document | null = null;
  private activeWindow: Window | null = null;
  private pressedAt: PointerPosition | null = null;
  private dragging = false;
  private lastMove: MouseEvent | null = null;
  private pendingFrame: number | null = null;
  private lastFrameMs: number | null = null;
  private lineDebt = 0;
  private capturedSelectionLines: string[] = [];
  private captureDirection = 0;
  private readonly copyTarget: HTMLElement;

  constructor(term: Terminal, swallowedMouseModes: ReadonlySet<number>, screen: HTMLElement) {
    this.term = term;
    this.swallowedMouseModes = swallowedMouseModes;
    this.screen = screen;
    this.copyTarget = term.element ?? screen;
    screen.addEventListener("mousedown", this.onMouseDown);
    this.copyTarget.addEventListener("copy", this.onCopy);
  }

  cancel(): void {
    this.stopFrame();
    if (this.activeDocument) {
      this.activeDocument.removeEventListener("mousemove", this.onDocumentMouseMove, true);
      this.activeDocument.removeEventListener("mouseup", this.onDocumentMouseUp, true);
    }
    this.activeWindow?.removeEventListener("blur", this.onWindowBlur);
    this.activeDocument = null;
    this.activeWindow = null;
    this.pressedAt = null;
    this.dragging = false;
    this.lastMove = null;
    this.lineDebt = 0;
  }

  dispose(): void {
    this.cancel();
    this.clearCapturedSelection();
    this.screen.removeEventListener("mousedown", this.onMouseDown);
    this.copyTarget.removeEventListener("copy", this.onCopy);
  }

  selectionTextForCopy(): string | null {
    if (!this.term.hasSelection()) {
      this.clearCapturedSelection();
      return null;
    }
    if (this.captureDirection !== 0) this.captureSelectionText(this.captureDirection);
    if (this.capturedSelectionLines.length === 0) return null;
    const captured = this.capturedSelectionLines.join("\n").trimEnd();
    const current = this.term.getSelection().trimEnd();
    return captured.length > current.length ? captured : null;
  }

  private stopFrame(): void {
    if (this.pendingFrame !== null) (this.activeWindow ?? window).cancelAnimationFrame(this.pendingFrame);
    this.pendingFrame = null;
    this.lastFrameMs = null;
  }

  private ensureFrame(): void {
    if (this.pendingFrame !== null) return;
    this.pendingFrame = (this.activeWindow ?? window).requestAnimationFrame(this.onFrame);
  }

  private clearCapturedSelection(): void {
    this.capturedSelectionLines = [];
    this.captureDirection = 0;
  }

  private captureSelectionText(direction: number): void {
    if (!this.term.hasSelection()) {
      this.clearCapturedSelection();
      return;
    }
    const lines = selectionLines(this.term.getSelection());
    if (lines.length === 0) return;
    this.captureDirection = direction;
    this.capturedSelectionLines = mergeSelectionLines(this.capturedSelectionLines, lines, direction);
  }

  private readonly onCopy = (event: ClipboardEvent): void => {
    const captured = this.selectionTextForCopy();
    if (!event.clipboardData || captured === null) return;
    event.clipboardData.setData("text/plain", captured);
    event.preventDefault();
  };

  private readonly onFrame = (now: number): void => {
    this.pendingFrame = null;
    const event = this.lastMove;
    if (!event || !this.dragging) return;
    if ((event.buttons & MAIN_BUTTON_MASK) === 0) {
      this.cancel();
      return;
    }
    const intensity = edgeIntensity(event, this.screen);
    if (intensity === 0) {
      this.lastFrameMs = null;
      this.lineDebt = 0;
      return;
    }

    if (this.term.buffer.active.type === "normal") {
      const targetDocument = this.activeDocument ?? this.screen.ownerDocument;
      if (!normalBufferSelectionCanMove(this.term, intensity)) {
        dispatchSelectionMove(targetDocument, event, clampPointerToScreen(event, this.screen));
        this.stopFrame();
        return;
      }
      dispatchSelectionMove(targetDocument, event, pointerOutsideScreenForXtermDragScroll(event, this.screen, intensity));
      this.ensureFrame();
      return;
    }

    const lastFrameMs = this.lastFrameMs ?? now;
    this.lastFrameMs = now;
    const elapsedSeconds = Math.min(MAX_FRAME_MS, Math.max(0, now - lastFrameMs)) / 1000;
    this.lineDebt += intensity * AUTO_SCROLL_LINES_PER_SECOND * getTerminalScrollSpeed() * elapsedSeconds;
    const lines = this.lineDebt < 0 ? Math.ceil(this.lineDebt) : Math.floor(this.lineDebt);
    if (lines !== 0) {
      this.lineDebt -= lines;
      const pointer = clampPointerToScreen(event, this.screen);
      this.captureSelectionText(lines);
      const scrolled = scrollTerminalUi(this.term, this.swallowedMouseModes, pointer, lines);
      if (!scrolled) {
        this.stopFrame();
        return;
      }
      dispatchSelectionMove(this.activeDocument ?? this.screen.ownerDocument, event, pointer);
    }
    this.ensureFrame();
  };

  private readonly onDocumentMouseMove = (event: MouseEvent): void => {
    if (syntheticSelectionMoves.has(event)) return;
    if ((event.buttons & MAIN_BUTTON_MASK) === 0) {
      this.cancel();
      return;
    }
    if (!this.dragging) {
      if (!this.pressedAt || !movedPastSlop(this.pressedAt, event)) return;
      this.dragging = true;
    }
    this.lastMove = event;
    if (edgeIntensity(event, this.screen) === 0) {
      this.stopFrame();
      this.lineDebt = 0;
      return;
    }
    this.ensureFrame();
  };

  private readonly onDocumentMouseUp = (): void => {
    if (this.captureDirection !== 0) this.captureSelectionText(this.captureDirection);
    this.cancel();
  };

  private readonly onWindowBlur = (): void => {
    this.cancel();
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button !== MAIN_BUTTON) return;
    if (xtermMouseTrackingOwnsDrag(this.term, event)) return;
    this.cancel();
    this.clearCapturedSelection();
    this.activeDocument = this.screen.ownerDocument;
    this.activeWindow = this.activeDocument.defaultView;
    this.pressedAt = { clientX: event.clientX, clientY: event.clientY };
    this.activeDocument.addEventListener("mousemove", this.onDocumentMouseMove, true);
    this.activeDocument.addEventListener("mouseup", this.onDocumentMouseUp, true);
    this.activeWindow?.addEventListener("blur", this.onWindowBlur);
  };
}

export function wireSelectionEdgeAutoScroll(term: Terminal, swallowedMouseModes: ReadonlySet<number>): SelectionEdgeAutoScrollHandle | null {
  const screen = screenElementOf(term);
  return screen ? new SelectionEdgeAutoScroller(term, swallowedMouseModes, screen) : null;
}
