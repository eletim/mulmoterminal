// Resume identity is a durable fact of a live Core session. Discovery happens asynchronously
// after the agent starts, so transient metadata failures are retried here instead of being hidden
// or mirrored into another Backend registry.
import { messageOf } from "../errors.js";
import { coreSessions } from "./core-session-adapter.js";

export interface CoreResumeSourceWriteDeps {
  setResumeSource: (id: string, sourceId: string) => Promise<void>;
  delay: (ms: number) => Promise<void>;
  warn: (message: string) => void;
  attempts?: number;
}

const defaults: CoreResumeSourceWriteDeps = {
  setResumeSource: (id, sourceId) => coreSessions.setResumeSource(id, sourceId),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  warn: (message) => console.warn(message),
};

export async function persistCoreResumeSource(id: string, sourceId: string, deps: CoreResumeSourceWriteDeps = defaults): Promise<boolean> {
  const attempts = Math.max(1, deps.attempts ?? 4);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await deps.setResumeSource(id, sourceId);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await deps.delay(100 * 2 ** attempt);
    }
  }
  deps.warn(`[core] could not persist resume source for ${id}: ${messageOf(lastError)}`);
  return false;
}
