import type { WebSocket } from "ws";
import type { SessionAgent } from "../../common/sessionAgent.js";
import { spawnTmuxViewerPty } from "./pty-spawn.js";
import { sendFrame } from "./ws-frames.js";
import type { PtyEntry } from "./types.js";
import { registerSecondaryViewer, unregisterSecondaryViewer } from "./viewer-state.js";

/** Attach an additional browser without replacing the process-local primary viewer transport.
 * The opaque viewport cursor remains in the browser; this object only owns its raw tmux client. */
export function spawnSecondaryViewer(sessionId: string, ws: WebSocket, cwd: string, agent: SessionAgent): PtyEntry {
  const term = spawnTmuxViewerPty(sessionId, cwd);
  const entry: PtyEntry = { term, ws, buffer: "", cwd, active: false, tmux: true, agent };
  registerSecondaryViewer(sessionId, entry);
  term.onData((data) => sendFrame(entry.ws, { type: "output", data }));
  // This is only a transient tmux client. Its exit says nothing about the Core session, so close
  // the socket without an `exit` frame and let the browser reconnect to the surviving session.
  term.onExit(() => {
    unregisterSecondaryViewer(sessionId, entry);
    entry.ws?.close();
  });
  return entry;
}
