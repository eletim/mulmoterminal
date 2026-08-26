import { promises as fs } from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../config/env.js";
import { parseSessionIdLog } from "./session-id-log.js";
import type { CoreSession, CoreSessionAdapter } from "./core-session-adapter.js";

const LEGACY_BACKGROUND_SESSIONS_FILE = path.join(MULMOTERMINAL_HOME, "background-sessions.json");

/**
 * One-time upgrade from the retired background id log. The log is never consulted by request
 * paths: classifications that still have Core membership are copied into Core metadata, then the
 * legacy file is removed so Core remains the sole live visibility source.
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
  await Promise.all(migrating.map((session) => core.setVisibility(session.id, "background")));
  await fs.rm(file, { force: true });
  return migrating.length;
}

/**
 * Terminal membership comes exclusively from Core. This is the narrower UI policy shared by
 * Desktop and Mobile: disposable probes and background helpers remain Core sessions, but are not
 * user terminal rows. Placement is deliberately absent because it is browser-local layout state.
 */
export async function visibleCoreSessions(sessions: readonly CoreSession[]): Promise<CoreSession[]> {
  return sessions.filter((session) => session.visibility === "normal");
}
