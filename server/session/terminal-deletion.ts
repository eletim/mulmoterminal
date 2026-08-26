/** Dependencies intentionally contain no activity/provider/runtime query. An explicit delete is
 * unconditional: Core kills canonical tmux membership, then local PTY bookkeeping is discarded. */
export interface TerminalDeletionDeps {
  reapLocalSession: (id: string) => void;
  deleteCoreSession: (id: string) => Promise<void>;
}

export async function forceDeleteTerminalSession(id: string, deps: TerminalDeletionDeps): Promise<void> {
  try {
    try {
      await deps.deleteCoreSession(id);
    } catch (error) {
      // Explicit deletion is idempotent. Core was still called; absence means membership is
      // already in the requested state, which also lets a failed worktree removal be retried.
      if (!(error instanceof CoreSessionNotFoundError)) throw error;
    }
  } finally {
    // A missing/broken Core session must not leave a transient viewer and its bookkeeping behind.
    deps.reapLocalSession(id);
  }
}
import { CoreSessionNotFoundError } from "./core-session-adapter.js";
