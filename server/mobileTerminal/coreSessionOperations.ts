import { coreSessions } from "../session/core-session-adapter.js";
import { createTerminalSessionOperations } from "./sessionOperations.js";

interface CoreOperations {
  stop: (sessionId: string) => Promise<void>;
  delete: (sessionId: string) => Promise<void>;
}

/** Bind the existing Mobile action meanings to Core without creating another lifecycle layer. */
export function createCoreSessionOperations(reap: (sessionId: string) => void, core: CoreOperations = coreSessions) {
  const remove = async (id: string): Promise<void> => {
    reap(id);
    await core.delete(id);
  };
  return createTerminalSessionOperations({ interrupt: (id) => core.stop(id), stop: remove, delete: remove });
}
