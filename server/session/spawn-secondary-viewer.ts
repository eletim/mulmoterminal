import type { WebSocket } from "ws";
import type { SessionAgent } from "../../common/sessionAgent.js";
import { isCoreSessionExitEvent, spawnTmuxViewerPty } from "./pty-spawn.js";
import { sendExitAndClose, sendFrame } from "./ws-frames.js";
import type { PtyEntry } from "./types.js";
import { registerSecondaryViewer, unregisterSecondaryViewer, viewerPtys } from "./viewer-state.js";

/** Attach an additional browser without replacing the process-local primary viewer transport.
 * The opaque viewport cursor remains in the browser; this object only owns its raw tmux client. */
export function spawnSecondaryViewer(sessionId: string, ws: WebSocket, cwd: string, agent: SessionAgent): PtyEntry {
  const primary = viewerPtys.get(sessionId);
  const size = primary ? { cols: primary.term.cols, rows: primary.term.rows } : undefined;
  const term = spawnTmuxViewerPty(sessionId, cwd, size);
  const entry: PtyEntry = { term, ws, buffer: "", cwd, active: false, tmux: true, agent };
  registerSecondaryViewer(sessionId, entry);
  term.onData((data) => sendFrame(entry.ws, { type: "output", data }));
  // A native exit belongs only to this transient tmux client. A Core exit is synthesized by the
  // exit-aware wrapper because remain-on-exit keeps the native client alive after the app dies.
  const exitSubscription: { current?: { dispose(): void } } = {};
  exitSubscription.current = term.onExit((event) => {
    exitSubscription.current?.dispose();
    unregisterSecondaryViewer(sessionId, entry);
    if (isCoreSessionExitEvent(event)) sendExitAndClose(entry.ws, event.exitCode, event.signal);
    else entry.ws?.close();
  });
  return entry;
}
