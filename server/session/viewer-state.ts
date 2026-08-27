// Process-local browser transport state. A viewer PTY attaches a browser to a Core-owned tmux
// pane and keeps a bounded replay tail; it never establishes Terminal membership or lifecycle.
import type { PtyEntry } from "./types.js";

export const viewerPtys = new Map<string, PtyEntry>();
