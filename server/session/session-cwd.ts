// Which directory a session is working in — the answer presentDocument / presentHtml's
// relative `path` is resolved against (see backends/presentPathRoot.ts).
//
// Three tiers, most-truthful first. `ptys` knows where the agent is ACTUALLY running, so
// it wins over the persisted note even when the two disagree: a cell relaunched somewhere
// else keeps its id but not its directory. The workspace fallback is what every caller
// that names no session gets — the scheduler, feeds, a direct POST — so their behaviour
// is exactly what it was before this existed.
import { CLAUDE_CWD } from "../config/env.js";
import { coreSessions, CoreSessionNotFoundError } from "./core-session-adapter.js";

/** Pure form, for tests and for callers that already hold the facts. Empty strings are
 *  treated as "not known" — `ptys` entries are built with a `?? ""` default upstream. */
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
