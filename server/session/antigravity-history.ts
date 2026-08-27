// Antigravity does not persist a conversation cwd, so history needs this association after Core
// membership is deleted. Live resume identity remains solely in Core.resumeSource.
import { promises as fs } from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../config/env.js";
import { messageOf } from "../errors.js";
import { forEachJsonlRecord } from "../infra/jsonl-file.js";
import {
  antigravityConversationLine,
  antigravityConversationRecord,
  applyAntigravityConversation,
  hydrateAntigravityConversationInto,
  type AntigravityConversation,
} from "./antigravity-conversations.js";

export const antigravityHistory = new Map<string, AntigravityConversation>();
const file = path.join(MULMOTERMINAL_HOME, "antigravity-conversations.jsonl");
const writtenIds = new Set<string>();

export const antigravityHistoryHydrated: Promise<void> = (async () => {
  try {
    await forEachJsonlRecord(file, (parsed) => {
      const record = antigravityConversationRecord(parsed, (id) => SESSION_ID_RE.test(id));
      if (record) hydrateAntigravityConversationInto(antigravityHistory, writtenIds, record);
    });
  } catch {
    // No Antigravity history yet.
  }
})();

let persist: Promise<void> = Promise.resolve();

export function rememberAntigravityHistory(sessionId: string, conversationId: string, cwd: string): void {
  if (!SESSION_ID_RE.test(sessionId) || !SESSION_ID_RE.test(conversationId) || !cwd) return;
  const known = antigravityHistory.get(sessionId);
  if (known?.conversationId === conversationId && known.cwd === cwd) return;
  const record: AntigravityConversation = { sessionId, conversationId, cwd, startedAt: known?.startedAt ?? Date.now() };
  writtenIds.add(sessionId);
  applyAntigravityConversation(antigravityHistory, record);
  persist = persist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(file, antigravityConversationLine(record)))
    .catch((error) => console.error(`[antigravity-history] failed to persist: ${messageOf(error)}`));
}
