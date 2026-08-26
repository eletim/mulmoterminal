import { promises as fs } from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../config/env.js";
import { parseSessionIdLog } from "./session-id-log.js";
import type { CoreSession, CoreSessionAdapter } from "./core-session-adapter.js";

const LEGACY_BACKGROUND_SESSIONS_FILE = path.join(MULMOTERMINAL_HOME, "background-sessions.json");

/**
 * Upgrade live sessions recorded by the history visibility owner before Core metadata existed.
 * Request paths never use the history record to classify live Terminal membership; this copies
 * the classification into Core so Core remains the sole live visibility source.
 */
export async function migrateLegacyBackgroundVisibility(
  core: Pick<CoreSessionAdapter, "list" | "setVisibility">,
  file = LEGACY_BACKGROUND_SESSIONS_FILE,
): Promise<number> {
  let contents: string;
  try {
    contents = await fs.readFile(file, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
  const legacyIds = new Set(parseSessionIdLog(contents, (id) => SESSION_ID_RE.test(id)));
  const sessions = await core.list();
  const migrating = sessions.filter((session) => legacyIds.has(session.id));
  const migrated = await Promise.allSettled(migrating.map((session) => core.setVisibility(session.id, "background")));
  return migrated.filter((result) => result.status === "fulfilled").length;
}

/**
 * Terminal membership comes exclusively from Core. This is the narrower UI policy shared by
 * Desktop and Mobile: disposable probes and background helpers remain Core sessions, but are not
 * user terminal rows. Placement is deliberately absent because it is browser-local layout state.
 */
export async function visibleCoreSessions(sessions: readonly CoreSession[]): Promise<CoreSession[]> {
  return sessions.filter((session) => session.visibility === "normal");
}
