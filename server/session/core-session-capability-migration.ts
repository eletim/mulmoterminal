// One-way upgrade from the retired Backend capability logs into live Core metadata. Old entries
// for deleted sessions are intentionally discarded: GUI capability is not conversation history.
import { promises as fs } from "node:fs";
import path from "node:path";
import { SESSION_ID_RE } from "../config/env.js";
import { parseSessionIdLog } from "./session-id-log.js";
import { parseLegacySessionToolGroups } from "./legacy-gui-capability-log.js";
import type { CoreSessionAdapter } from "./core-session-adapter.js";

const GROUPS_FILE = "session-tool-groups.json";
const ALL_TOOLS_FILE = "all-tools-sessions.json";

const read = async (file: string): Promise<string> => fs.readFile(file, "utf8").catch(() => "");

export async function migrateLegacyGuiCapabilities(core: Pick<CoreSessionAdapter, "list" | "learnGuiCapabilities">, home: string): Promise<number> {
  const groupsFile = path.join(home, GROUPS_FILE);
  const allToolsFile = path.join(home, ALL_TOOLS_FILE);
  const [sessions, groupContents, allToolsContents] = await Promise.all([core.list(), read(groupsFile), read(allToolsFile)]);
  const groupsById = new Map<string, ReturnType<typeof parseLegacySessionToolGroups>[number]["group"][]>();
  for (const { sessionId, group } of parseLegacySessionToolGroups(groupContents, (id) => SESSION_ID_RE.test(id))) {
    groupsById.set(sessionId, [...(groupsById.get(sessionId) ?? []), group]);
  }
  const allTools = new Set(parseSessionIdLog(allToolsContents, (id) => SESSION_ID_RE.test(id)));
  const candidates = sessions.filter((session) => groupsById.has(session.id) || allTools.has(session.id));
  await Promise.all(candidates.map((session) => core.learnGuiCapabilities(session.id, groupsById.get(session.id) ?? [], allTools.has(session.id))));
  await Promise.all([fs.rm(groupsFile, { force: true }), fs.rm(allToolsFile, { force: true })]);
  return candidates.length;
}
