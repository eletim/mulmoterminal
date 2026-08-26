export interface TerminalSessionOperationDeps {
  interrupt: (sessionId: string) => Promise<void>;
  stop: (sessionId: string) => Promise<void>;
  delete: (sessionId: string) => Promise<void>;
}

export function createTerminalSessionOperations(deps: TerminalSessionOperationDeps) {
  return {
    interruptSession: (sessionId: string): Promise<void> => deps.interrupt(sessionId),
    stopSession: (sessionId: string): Promise<void> => deps.stop(sessionId),
    deleteSession: (sessionId: string): Promise<void> => deps.delete(sessionId),
  };
}
