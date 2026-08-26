// Pure decision for how a /ws connection should (re)connect a requested session id.
// Split out from index.ts so the flag choice — the one that decides `--resume` vs
// `--session-id` — is unit-testable without a pty, tmux, or the filesystem.

export interface SessionFacts {
  // Core membership is the only fact that says this terminal still exists.
  coreExists: boolean;
  // A viewer transport for the Core session is already present in this process.
  hasViewer: boolean;
  // An on-disk transcript exists in the target workspace (claude writes it after the
  // first prompt) — the only id claude will `--resume`.
  onDisk: boolean;
}

export interface SessionResolution {
  reattachId: string | null; // reattach this same-process pty (no new claude)
  resume: string | null; // `--resume` this on-disk transcript
  sessionId: string; // the id claude effectively runs as
}

// An on-disk conversation is resumed only when Core has no terminal by that id. The resumed
// process is created under a newly minted Core id, keeping history identity separate from terminal
// membership identity.
export function resolveSession(requested: string | null, facts: SessionFacts, mintId: () => string): SessionResolution {
  const reattachId = requested && facts.coreExists && facts.hasViewer ? requested : null;
  const resume = requested && !facts.coreExists && facts.onDisk ? requested : null;
  // History is an agent resume source, not terminal membership. Resuming it always creates a
  // new Core session id; only a session still present in Core keeps its terminal id.
  const sessionId = requested && facts.coreExists ? requested : mintId();
  return { reattachId, resume, sessionId };
}

// ── the same decision for the two non-claude terminals ─────────────────────────

/** Keep a requested id only when it remains a Core member. A process-local viewer may be reused
 *  for transport, but cannot create membership; agent history always resumes under a fresh id. */
export function resolveReattachableId(
  requested: string | null,
  facts: { coreExists: boolean; hasViewer: boolean },
  mintId: () => string,
): { reattachId: string | null; sessionId: string } {
  const reattachId = requested && facts.coreExists && facts.hasViewer ? requested : null;
  const sessionId = requested && facts.coreExists ? requested : mintId();
  return { reattachId, sessionId };
}

/**
 * Whether a connection CONTINUES a session rather than creating one.
 *
 * Both resolvers keep the requested id exactly for Core membership. History resume mints a new
 * id and is therefore a new terminal, even though the agent continues an old conversation.
 */
export const isContinuingSession = (requested: string | null, sessionId: string): boolean => requested !== null && requested === sessionId;

/** Whether a launcher connection may start at all. A reattach needs no launcher index —
 *  the pty already IS the chosen program — and the header's "new terminal" button runs the
 *  default shell with no configured index. Otherwise the index must name a real launcher,
 *  or there is nothing to run. */
export function canStartLauncher(facts: { coreExists: boolean; hasLauncher: boolean; isShell: boolean }): boolean {
  return facts.coreExists || facts.hasLauncher || facts.isShell;
}
