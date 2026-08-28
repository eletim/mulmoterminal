// Process-local browser transport state. A viewer PTY attaches a browser to a Core-owned tmux
// pane and keeps a bounded replay tail; it never establishes Terminal membership or lifecycle.
import type { PtyEntry } from "./types.js";

export const viewerPtys = new Map<string, PtyEntry>();

// Additional browser transports are intentionally absent from viewerPtys so they cannot replace
// the primary reattach target. They are tracked only to aggregate viewer activity; viewport
// cursors and scroll positions remain browser-local and never enter this registry.
const secondaryViewerPtys = new Map<string, Set<PtyEntry>>();

export function registerSecondaryViewer(sessionId: string, entry: PtyEntry): void {
  const viewers = secondaryViewerPtys.get(sessionId) ?? new Set<PtyEntry>();
  viewers.add(entry);
  secondaryViewerPtys.set(sessionId, viewers);
}

export function unregisterSecondaryViewer(sessionId: string, entry: PtyEntry): void {
  const viewers = secondaryViewerPtys.get(sessionId);
  if (!viewers) return;
  viewers.delete(entry);
  if (viewers.size === 0) secondaryViewerPtys.delete(sessionId);
}

export function secondaryViewersOf(sessionId: string): readonly PtyEntry[] {
  return [...(secondaryViewerPtys.get(sessionId) ?? [])];
}

export function isViewerActive(sessionId: string, primary: PtyEntry | undefined): boolean {
  if (primary?.active) return true;
  return [...(secondaryViewerPtys.get(sessionId) ?? [])].some((entry) => entry.active);
}
