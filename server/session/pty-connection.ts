// What happens on a terminal connection once it exists: handing a live PTY to a new
// socket, dispatching the frames a browser sends, and deciding the PTY's fate when the
// socket goes away. Split from index.ts (#548 step 3d) — shared by every terminal
// endpoint (/ws, /ws/launch, /ws/codex), so it comes out ahead of the handlers.
//
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";
import { messageOf } from "../errors.js";
import { isResizeFrame, sendFrame } from "./ws-frames.js";
import { isRecord } from "../../common/isRecord.js";
import { stripTerminalQueries, terminalModePrefix, terminalModeRestorePrefix } from "./terminal-replay.js";
import type { PtyEntry } from "./types.js";
import { unregisterSecondaryViewer, viewerPtys } from "./viewer-state.js";
import { isScrollRequest, isViewportRequest, type BrowserScrollRequest, type BrowserViewportRequest } from "../../common/terminalViewport.js";
import type { ScrollIntent, ScrollResult, TerminalViewport, ViewportCursor } from "tmux-session-core-ts";

export interface ViewerReleaseDeps {
  forgetTerminalSize: (id: string) => void;
}

/** Release only this process's transient tmux client. Core/tmux membership is untouched. */
export function releaseViewer(deps: ViewerReleaseDeps, id: string, expected?: PtyEntry): boolean {
  const entry = viewerPtys.get(id);
  if (!entry || (expected && entry !== expected)) return false;
  viewerPtys.delete(id);
  deps.forgetTerminalSize(id);
  try {
    entry.term.kill();
  } catch {
    // The transient client already exited.
  }
  return true;
}

/** Graceful shutdown owns viewers, not Core sessions. */
export function releaseAllViewers(deps: ViewerReleaseDeps): string[] {
  const released: string[] = [];
  for (const id of [...viewerPtys.keys()]) {
    try {
      if (releaseViewer(deps, id)) released.push(id);
    } catch (error) {
      console.error(`[shutdown] failed to release viewer ${id}: ${messageOf(error)}`);
    }
  }
  return released;
}

/** A frame as it arrives off the socket. Only `toString()` is used — ws hands us a
 *  Buffer, and narrowing to this lets a test pass one without a live connection. */
export type WireFrame = { toString(): string };

export interface ConnectionDeps {
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  viewport: CoreSessionAdapter["viewport"];
  scroll: CoreSessionAdapter["scroll"];
  setWaiting: (id: string, waiting: boolean) => void;
  /** Socket gone: release only the transient viewer; Core membership remains. */
  releaseViewer: (id: string, expected?: PtyEntry) => void;
  /** The screen-buffer / mouse modes this session's pane is in right now, for the replay to
   *  re-establish (#1073). Empty when there is nothing to restore. */
  terminalModesOf: (id: string) => readonly number[];
  /** Ask tmux to repaint the whole pane, so a reattached browser stops showing whatever the
   *  replayed delta window happened to reconstruct (#1073). `clientPid` identifies OUR tmux client
   *  among the several a session can carry — it is the pty's own pid. */
  redrawTerminal: (id: string, clientPid: number) => void;
  /** Check, once the resize burst settles, that tmux's window really is the size the browser
   *  asked for — and force it if not. A repaint cannot fix a window that is genuinely too small,
   *  and nothing else closes that gap (#957, session/tmux-size-sync.ts). */
  checkTerminalSize: (id: string, size: { cols: number; rows: number }) => void;
  /** Re-verify the window against the size the browser last asked for, with no new resize frame to
   *  hang off. Every check used to need one, so a window that drifted — or was never corrected
   *  because the frame that would have corrected it went missing — had nothing to notice (#1178). */
  recheckTerminalSize: (id: string) => void;
  /** The socket is gone, so a settling size check has nobody to repair the screen for. */
  cancelTerminalSizeCheck: (id: string) => void;
  /** Current PTY entry for this session id. A missing/different entry means this close is stale. */
  currentEntryOf?: (id: string) => PtyEntry | undefined;
}

type CoreSessionAdapter = Pick<import("./core-session-adapter.js").CoreSessionAdapter, "viewport" | "scroll">;

function opaqueCursor(value: string): ViewportCursor {
  // Core owns the token format. The transport validates only that the browser returned a string
  // and applies Core's nominal type without decoding or persisting it.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return value as ViewportCursor;
}

type RestoredTerminalViewport = TerminalViewport & { restore?: string };

function restoreLiveViewportModes(viewport: TerminalViewport, modes: readonly number[]): RestoredTerminalViewport {
  return viewport.live ? { ...viewport, restore: terminalModeRestorePrefix(modes) } : viewport;
}

function restoreLiveScrollModes(result: ScrollResult, modes: readonly number[]): ScrollResult {
  return result.kind === "viewport" ? { ...result, viewport: restoreLiveViewportModes(result.viewport, modes) } : result;
}

async function forwardViewport(
  deps: Pick<ConnectionDeps, "viewport" | "terminalModesOf">,
  ws: WebSocket,
  sessionId: string,
  msg: BrowserViewportRequest,
): Promise<void> {
  try {
    const cursor = msg.cursor === undefined ? undefined : opaqueCursor(msg.cursor);
    const viewport = await deps.viewport(sessionId, { target: cursor ? { kind: "cursor", cursor } : { kind: "live" }, rows: msg.rows, format: "ansi" });
    const restored = viewport.live ? restoreLiveViewportModes(viewport, deps.terminalModesOf(sessionId)) : viewport;
    sendFrame(ws, { type: "viewport", requestId: msg.requestId, viewport: restored });
  } catch (error) {
    console.warn(`[ws] viewport dropped for ${sessionId}: ${messageOf(error)}`);
    sendFrame(ws, { type: "viewport-error", requestId: msg.requestId });
  }
}

async function forwardScroll(
  deps: Pick<ConnectionDeps, "scroll" | "terminalModesOf">,
  ws: WebSocket,
  sessionId: string,
  msg: BrowserScrollRequest,
): Promise<void> {
  const intent: ScrollIntent = {
    direction: msg.direction,
    lines: msg.lines,
    rows: msg.rows,
    format: "ansi",
    ...(msg.cursor === undefined ? {} : { cursor: opaqueCursor(msg.cursor) }),
    ...(msg.cell === undefined ? {} : { cell: msg.cell }),
  };
  try {
    const result = await deps.scroll(sessionId, intent);
    const restored = result.kind === "viewport" && result.viewport.live ? restoreLiveScrollModes(result, deps.terminalModesOf(sessionId)) : result;
    sendFrame(ws, { type: "scroll-result", requestId: msg.requestId, result: restored });
  } catch (error) {
    console.warn(`[ws] scroll dropped for ${sessionId}: ${messageOf(error)}`);
    sendFrame(ws, { type: "scroll-error", requestId: msg.requestId });
  }
}

// The one place a browser's bytes become data. Answers a plain record so every field below is
// read through a check — `JSON.parse` alone hands back `any`, which would put the whole frame,
// including whatever gets written to the PTY, outside the type checker.
function parseClientFrame(raw: WireFrame): Record<string, unknown> | null {
  try {
    const msg: unknown = JSON.parse(raw.toString());
    return isRecord(msg) ? msg : null; // not an object — never write arbitrary payloads to the PTY
  } catch {
    return null; // not JSON at all
  }
}

// browser -> command PTY. Like handleClientFrame but for the session-less command
// terminal: only input/resize (no session machinery).
export function handleCommandFrame(term: IPty, raw: WireFrame) {
  const msg = parseClientFrame(raw);
  if (!msg) return;
  try {
    if (msg.type === "input" && typeof msg.data === "string") {
      term.write(msg.data);
    } else if (isResizeFrame(msg)) {
      term.resize(msg.cols, msg.rows);
    }
  } catch (err) {
    console.warn(`[ws/run] dropped message: ${messageOf(err)}`);
  }
}

// The user's focus moved onto/off a pane (a grid cell zoomed/opened, or blurred). An active pane
// suppresses the attention flag and marks it read; an inactive grid cell can surface blocked/done
// among its siblings.
//
// Coming into view is also when a wrong terminal size is worth catching: the user is looking at
// this pane, and is not typing into it yet. Until #1178 the size was only ever checked when a
// resize frame arrived, so a pane that never got one had nothing to notice.
function applyViewFrame(entry: PtyEntry, sessionId: string, active: boolean, deps: Pick<ConnectionDeps, "setWaiting" | "recheckTerminalSize">): void {
  entry.active = active;
  if (!active) return;
  deps.setWaiting(sessionId, false);
  if (entry.tmux) deps.recheckTerminalSize(sessionId);
}

function closeClient(deps: ConnectionDeps, entry: PtyEntry, ws: WebSocket, sessionId: string): void {
  if (entry.ws !== ws) return;
  if (deps.currentEntryOf && deps.currentEntryOf(sessionId) !== entry) {
    entry.ws = null;
    entry.active = false;
    unregisterSecondaryViewer(sessionId, entry);
    try {
      entry.term.kill();
    } catch {
      // The secondary viewer's tmux client already exited.
    }
    return;
  }
  entry.ws = null;
  deps.cancelTerminalSizeCheck(sessionId);
  // A session with no live socket is not being viewed. Clear `active` after an unclean disconnect
  // so attention reporting resumes until a reconnect explicitly views the pane again.
  entry.active = false;
  console.log(`[ws] disconnected ${sessionId}`);
  deps.releaseViewer(sessionId, entry);
}

type ResizeTails = WeakMap<PtyEntry, Promise<void>>;

function queueResize(tails: ResizeTails, deps: Pick<ConnectionDeps, "resize">, entry: PtyEntry, sessionId: string, cols: number, rows: number): void {
  const resize = () => deps.resize(sessionId, cols, rows).catch((error) => console.warn(`[ws] resize dropped for ${sessionId}: ${messageOf(error)}`));
  const previous = tails.get(entry);
  const current = previous ? previous.then(resize) : resize();
  tails.set(entry, current);
  void current.finally(() => {
    if (tails.get(entry) === current) tails.delete(entry);
  });
}

function afterPendingResize(tails: ResizeTails, entry: PtyEntry, ws: WebSocket, operation: () => Promise<void>): void {
  const run = () => (entry.ws === ws ? operation() : Promise.resolve());
  const pending = tails.get(entry);
  void (pending ? pending.then(run) : run());
}

function ownsGeometry(deps: Pick<ConnectionDeps, "currentEntryOf">, entry: PtyEntry, sessionId: string): boolean {
  const primary = deps.currentEntryOf?.(sessionId);
  return !primary || primary === entry;
}

export function createConnectionHandlers(deps: ConnectionDeps) {
  const resizeTails = new WeakMap<PtyEntry, Promise<void>>();

  // Attach a replacement socket to an existing viewer transport: drop any stale socket,
  // swap in the new one, and replay the buffered tail for context.
  function reattachPty(entry: PtyEntry, ws: WebSocket, sessionId: string): PtyEntry {
    console.log(`[ws] reattach ${sessionId} (pid=${entry.term.pid})`);
    // Drop any socket still attached (e.g. the same session open in another tab).
    // Tell it it's been superseded FIRST so it stops instead of auto-reconnecting —
    // otherwise two clients on one session ping-pong (each reattach kicks the other,
    // the kicked one reconnects, …) into a storm.
    if (entry.ws && entry.ws !== ws && entry.ws.readyState === entry.ws.OPEN) {
      try {
        entry.ws.send(JSON.stringify({ type: "superseded" }));
      } catch {
        // socket already going away — closing below is enough
      }
      entry.ws.close();
    }
    entry.ws = ws;
    if (ws.readyState === ws.OPEN) {
      // The replay is a bounded TAIL, and the modes an app sets once at startup — the alternate
      // buffer above all — fell off its front long ago. Restore them first, or the browser draws
      // this into the normal buffer and the wheel stops reaching the app (#1073). Only a tmux
      // session can be asked; anything else replays as before.
      const prefix = entry.tmux ? terminalModePrefix(deps.terminalModesOf(sessionId)) : "";
      // Strip terminal queries from the replay so xterm doesn't re-answer them as stray input
      // (e.g. a DA reply surfacing as "0;276;0c" in the prompt) — see terminal-replay.ts.
      const data = prefix + stripTerminalQueries(entry.buffer);
      if (data) ws.send(JSON.stringify({ type: "output", data }));
      // What that replay draws is only the part of the screen that changed inside the window, so
      // the real screen is asked for once the client reports the size it settled at, below.
      if (entry.tmux) entry.redrawPending = true;
    }
    return entry;
  }

  // browser -> PTY. The protocol is client-controlled, so validate every frame
  // before touching node-pty (bad cols/rows or non-string input can throw).
  function handleClientFrame(entry: PtyEntry, ws: WebSocket, raw: WireFrame, sessionId: string) {
    // Ignore frames from a socket that a newer client has already superseded.
    if (entry.ws !== ws) return;
    const msg = parseClientFrame(raw);
    if (!msg) return;
    try {
      if (msg.type === "view" && typeof msg.active === "boolean") {
        applyViewFrame(entry, sessionId, msg.active, deps);
      } else if (msg.type === "input" && typeof msg.data === "string") {
        // This PTY is the attached tmux client. Raw replies to terminal modes that tmux enabled,
        // including mouse reports, must return through that client instead of bypassing its
        // protocol parser through Core's pane-injection path (#193).
        entry.term.write(msg.data);
      } else if (isViewportRequest(msg)) {
        afterPendingResize(resizeTails, entry, ws, () => forwardViewport(deps, ws, sessionId, msg));
      } else if (isScrollRequest(msg)) {
        afterPendingResize(resizeTails, entry, ws, () => forwardScroll(deps, ws, sessionId, msg));
      } else if (isResizeFrame(msg)) {
        // One tmux pane has one geometry. Secondary viewers keep independent viewport cursors,
        // but cannot resize their tmux client without `window-size latest` also moving the shared
        // pane underneath the primary viewer.
        if (!ownsGeometry(deps, entry, sessionId)) return;
        entry.term.resize(msg.cols, msg.rows);
        queueResize(resizeTails, deps, entry, sessionId, msg.cols, msg.rows);
        // A size that CHANGED already makes tmux redraw; one that matches what the pty had leaves
        // it silent, and the reattached browser would keep the half-built screen forever — the
        // alternate buffer it now restores into does not reflow, so no later resize repairs it.
        if (entry.redrawPending) {
          entry.redrawPending = false;
          deps.redrawTerminal(sessionId, entry.term.pid);
        }
        // And a repaint is only worth as much as the window it repaints: the same silence means
        // tmux can be left believing in a size the client abandoned long ago (#957).
        if (entry.tmux) deps.checkTerminalSize(sessionId, { cols: msg.cols, rows: msg.rows });
      }
    } catch (err) {
      // e.g. a write/resize that races the PTY exiting — drop it, never crash.
      console.warn(`[ws] dropped message for ${sessionId}: ${messageOf(err)}`);
    }
  }

  const handleClientClose = (entry: PtyEntry, ws: WebSocket, sessionId: string): void => closeClient(deps, entry, ws, sessionId);
  return { reattachPty, handleClientFrame, handleClientClose };
}
