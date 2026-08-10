const EDGE_TRIGGER_PX = 24;
const MAX_SYNTHETIC_OFFSET_PX = 24;
const MAIN_BUTTON = 0;
const MAIN_BUTTON_MASK = 1;
const syntheticMoves = new WeakSet<MouseEvent>();

interface SelectionAutoScrollTerminal {
  readonly element: HTMLElement | undefined;
  readonly modes: { readonly mouseTrackingMode: string };
  readonly options?: { readonly macOptionClickForcesSelection?: boolean };
}

export interface SelectionEdgeAutoScrollHandle {
  cancel(): void;
  dispose(): void;
}

function screenElementOf(term: SelectionAutoScrollTerminal): HTMLElement | null {
  return term.element?.querySelector(".xterm-screen") ?? null;
}

function mouseTrackingActive(term: SelectionAutoScrollTerminal): boolean {
  return term.modes.mouseTrackingMode !== "none";
}

function isMacPlatform(): boolean {
  return navigator.userAgent.includes("Macintosh");
}

function forcesSelection(term: SelectionAutoScrollTerminal, event: MouseEvent): boolean {
  if (isMacPlatform()) return event.altKey && term.options?.macOptionClickForcesSelection !== false;
  return event.shiftKey;
}

function syntheticYForEdge(event: MouseEvent, screen: HTMLElement): number | null {
  const rect = screen.getBoundingClientRect();
  if (rect.height <= 0) return null;
  const y = event.clientY - rect.top;
  if (y < 0 || y > rect.height) return null;

  if (y < EDGE_TRIGGER_PX) {
    const offset = Math.max(1, Math.round(((EDGE_TRIGGER_PX - y) / EDGE_TRIGGER_PX) * MAX_SYNTHETIC_OFFSET_PX));
    return rect.top - offset;
  }

  const bottomDistance = rect.height - y;
  if (bottomDistance < EDGE_TRIGGER_PX) {
    const offset = Math.max(1, Math.round(((EDGE_TRIGGER_PX - bottomDistance) / EDGE_TRIGGER_PX) * MAX_SYNTHETIC_OFFSET_PX));
    return rect.bottom + offset;
  }

  return null;
}

function cloneMouseMove(event: MouseEvent, clientY: number): MouseEvent {
  const synthetic = new MouseEvent("mousemove", {
    bubbles: true,
    cancelable: true,
    view: event.view,
    detail: event.detail,
    screenX: event.screenX,
    screenY: event.screenY,
    clientX: event.clientX,
    clientY,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    button: event.button,
    buttons: event.buttons,
    relatedTarget: event.relatedTarget,
  });
  syntheticMoves.add(synthetic);
  return synthetic;
}

class SelectionEdgeAutoScroller implements SelectionEdgeAutoScrollHandle {
  private readonly term: SelectionAutoScrollTerminal;
  private readonly screen: HTMLElement;
  private activeDocument: Document | null = null;
  private activeWindow: Window | null = null;
  private pendingFrame: number | null = null;
  private lastMove: MouseEvent | null = null;

  constructor(term: SelectionAutoScrollTerminal, screen: HTMLElement) {
    this.term = term;
    this.screen = screen;
    screen.addEventListener("mousedown", this.onMouseDown);
  }

  private clearPendingFrame(): void {
    if (this.pendingFrame !== null) (this.activeWindow ?? window).cancelAnimationFrame(this.pendingFrame);
    this.pendingFrame = null;
    this.lastMove = null;
  }

  cancel(): void {
    this.clearPendingFrame();
    if (this.activeDocument) {
      this.activeDocument.removeEventListener("mousemove", this.onDocumentMouseMove, true);
      this.activeDocument.removeEventListener("mouseup", this.onDocumentMouseUp, true);
    }
    this.activeWindow?.removeEventListener("blur", this.onWindowBlur);
    this.activeDocument = null;
    this.activeWindow = null;
  }

  dispose(): void {
    this.cancel();
    this.screen.removeEventListener("mousedown", this.onMouseDown);
  }

  private readonly dispatchPendingMove = (): void => {
    this.pendingFrame = null;
    const event = this.lastMove;
    const doc = this.activeDocument;
    if (!event || !doc) return;
    this.lastMove = null;
    const clientY = syntheticYForEdge(event, this.screen);
    if (clientY === null) return;
    doc.dispatchEvent(cloneMouseMove(event, clientY));
  };

  private scheduleSyntheticMove(event: MouseEvent): void {
    this.lastMove = event;
    if (this.pendingFrame !== null) return;
    this.pendingFrame = (this.activeWindow ?? window).requestAnimationFrame(this.dispatchPendingMove);
  }

  private readonly onDocumentMouseMove = (event: MouseEvent): void => {
    if (syntheticMoves.has(event)) return;
    if ((event.buttons & MAIN_BUTTON_MASK) === 0) {
      this.cancel();
      return;
    }
    const clientY = syntheticYForEdge(event, this.screen);
    if (clientY === null) {
      this.clearPendingFrame();
      return;
    }
    this.scheduleSyntheticMove(event);
  };

  private readonly onDocumentMouseUp = (): void => {
    this.cancel();
  };

  private readonly onWindowBlur = (): void => {
    this.cancel();
  };

  readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button !== MAIN_BUTTON) return;
    if (mouseTrackingActive(this.term) && !forcesSelection(this.term, event)) return;
    this.cancel();
    this.activeDocument = this.screen.ownerDocument;
    this.activeWindow = this.activeDocument.defaultView;
    this.startDocumentListeners();
  };

  private readonly startDocumentListeners = (): void => {
    if (!this.activeDocument) return;
    this.activeDocument.addEventListener("mousemove", this.onDocumentMouseMove, true);
    this.activeDocument.addEventListener("mouseup", this.onDocumentMouseUp, true);
    this.activeWindow?.addEventListener("blur", this.onWindowBlur);
  };
}

export function wireSelectionEdgeAutoScroll(term: SelectionAutoScrollTerminal): SelectionEdgeAutoScrollHandle | null {
  const screen = screenElementOf(term);
  return screen ? new SelectionEdgeAutoScroller(term, screen) : null;
}
