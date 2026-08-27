// Which directory a session is working in — the answer presentDocument / presentHtml's
// relative `path` is resolved against (see backends/presentPathRoot.ts).
//
// Core owns the session cwd. The workspace fallback applies only when no Core member can
// be resolved, and does not create Terminal membership.
import { CLAUDE_CWD } from "../config/env.js";
import { coreSessions, CoreSessionNotFoundError } from "./core-session-adapter.js";

/** Pure form, for tests and for callers that already hold the facts. Empty Core metadata is
 * treated as "not known". */
export function pickSessionCwd(facts: { coreCwd?: string | null | undefined; workspace: string }): string {
  return facts.coreCwd || facts.workspace;
}

/** The directory for a session id, falling back to the workspace when the id is absent,
 *  unknown, or was never recorded with one. */
export async function cwdForSession(id: string | null | undefined): Promise<string> {
  if (!id) return CLAUDE_CWD;
  try {
    return pickSessionCwd({ coreCwd: (await coreSessions.get(id)).cwd, workspace: CLAUDE_CWD });
  } catch (error) {
    if (error instanceof CoreSessionNotFoundError) return CLAUDE_CWD;
    throw error;
  }
}
