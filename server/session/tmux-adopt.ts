import type { WebSocket } from "ws";
import type { PtyEntry } from "./types.js";

export interface AdoptableTerminalWriterDeps {
  entryOf: (sessionId: string) => PtyEntry | undefined;
  hasTmux: (sessionId: string) => boolean;
  cwdOf: (sessionId: string) => string;
  spawnLauncherPty: (sessionId: string, ws: WebSocket | null, command: string, cwd: string) => PtyEntry;
  commandOf: (sessionId: string) => string;
}

export function createAdoptingTerminalWriter(deps: AdoptableTerminalWriterDeps): (sessionId: string, chunk: string) => boolean {
  return (sessionId: string, chunk: string): boolean => {
    let entry = deps.entryOf(sessionId);
    if (!entry && deps.hasTmux(sessionId)) {
      try {
        entry = deps.spawnLauncherPty(sessionId, null, deps.commandOf(sessionId), deps.cwdOf(sessionId));
      } catch {
        return false;
      }
    }
    if (!entry) return false;
    try {
      entry.term.write(chunk);
      return true;
    } catch {
      return false;
    }
  };
}
