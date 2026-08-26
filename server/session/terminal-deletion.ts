/** Dependencies intentionally contain no activity/provider/runtime query. An explicit delete is
 * unconditional: Core kills canonical tmux membership, then local PTY bookkeeping is discarded. */
export interface TerminalDeletionDeps {
  reapLocalSession: (id: string) => void;
  deleteCoreSession: (id: string) => Promise<void>;
}

export async function forceDeleteTerminalSession(id: string, deps: TerminalDeletionDeps): Promise<void> {
  try {
    await deps.deleteCoreSession(id);
  } finally {
    // A missing/broken Core session must not leave a transient viewer and its bookkeeping behind.
    deps.reapLocalSession(id);
  }
}
