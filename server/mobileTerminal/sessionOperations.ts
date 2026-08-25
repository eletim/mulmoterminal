import { recordSessionDeleted } from "../session/session-lifecycle-records.js";

export interface TerminalSessionOperationDeps {
  writeToSession: (sessionId: string, chunk: string) => boolean;
  reapSession: (sessionId: string) => void;
  hasTmux: (sessionId: string) => boolean;
  killTmux: (sessionId: string) => void;
}

export function createTerminalSessionOperations({ writeToSession, reapSession, hasTmux, killTmux }: TerminalSessionOperationDeps) {
  return {
    interruptSession: (sessionId: string): boolean => writeToSession(sessionId, "\x03"),
    stopSession: (sessionId: string): void => {
      reapSession(sessionId);
      if (hasTmux(sessionId)) {
        killTmux(sessionId);
      }
      recordSessionDeleted(sessionId);
    },
  };
}
