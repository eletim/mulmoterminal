// One-way upgrade of the retired scheduler id log. Scheduler origin is useful only for a current
// Core member (push policy); deleted ids are history and deliberately discarded.
import { promises as fs } from "node:fs";
import path from "node:path";
import { SESSION_ID_RE } from "../config/env.js";
import { parseSessionIdLog } from "./session-id-log.js";
import type { CoreSessionAdapter } from "./core-session-adapter.js";

const LEGACY_FILE = "user-scheduled-sessions.json";

export async function migrateLegacyScheduledOrigins(core: Pick<CoreSessionAdapter, "list" | "setOrigin">, home: string): Promise<number> {
  const file = path.join(home, LEGACY_FILE);
  let contents = "";
  try {
    contents = await fs.readFile(file, "utf8");
  } catch {
    return 0;
  }
  const scheduled = new Set(parseSessionIdLog(contents, (id) => SESSION_ID_RE.test(id)));
  const candidates = (await core.list()).filter((session) => scheduled.has(session.id));
  await Promise.all(candidates.map((session) => core.setOrigin(session.id, "scheduled")));
  await fs.rm(file, { force: true });
  return candidates.length;
}

export async function removeRetiredSessionStateFiles(home: string): Promise<void> {
  await Promise.all(["activity-state.json", "codex-rollout-ids.log"].map((name) => fs.rm(path.join(home, name), { force: true })));
}
