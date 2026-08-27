import { coreSessions } from "../session/core-session-adapter.js";
import { createTerminalSessionOperations } from "./sessionOperations.js";

interface CoreOperations {
  stop: (sessionId: string) => Promise<void>;
  delete: (sessionId: string) => Promise<void>;
}

/** Bind transport actions directly to their Core contracts. */
export function createCoreSessionOperations(core: CoreOperations = coreSessions) {
  return createTerminalSessionOperations({
    interrupt: (id) => core.stop(id),
    stop: (id) => core.stop(id),
    delete: (id) => core.delete(id),
  });
}
