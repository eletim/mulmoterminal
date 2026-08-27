// User-authored notes for deleted conversation history. A live session's memo is owned only by
// Core metadata; explicit Delete performs the one-way handoff into this history store.
import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeMemo } from "../../common/sessionMemo.js";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../config/env.js";
import { messageOf } from "../errors.js";
import { forEachJsonlRecord } from "../infra/jsonl-file.js";
import { applySessionMemo, createMemoWriteGuard, sessionMemoLine, sessionMemoRecord } from "./session-memos.js";

export const sessionMemos = new Map<string, string>();
const file = path.join(MULMOTERMINAL_HOME, "session-memos.jsonl");
const writtenIds = new Set<string>();

export const sessionMemosHydrated: Promise<void> = (async () => {
  try {
    await forEachJsonlRecord(file, (parsed) => {
      const record = sessionMemoRecord(parsed, (id) => SESSION_ID_RE.test(id));
      if (record && !writtenIds.has(record.id)) applySessionMemo(sessionMemos, record);
    });
  } catch {
    // No history memo store yet.
  }
})();

let persist: Promise<void> = Promise.resolve();
const writes = createMemoWriteGuard();

export async function setSessionMemo(id: string, text: string): Promise<string> {
  const memo = normalizeMemo(text);
  if (!SESSION_ID_RE.test(id)) return memo;
  const previous = sessionMemos.get(id);
  const ticket = writes.begin(id);
  writtenIds.add(id);
  applySessionMemo(sessionMemos, { id, text: memo });
  const append = persist.then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true })).then(() => fs.appendFile(file, sessionMemoLine(id, memo, Date.now())));
  persist = append.catch(() => {});
  try {
    await append;
  } catch (error) {
    if (writes.isLatest(id, ticket)) applySessionMemo(sessionMemos, { id, text: previous ?? "" });
    throw new Error(`failed to persist the memo: ${messageOf(error)}`, { cause: error });
  }
  return memo;
}

export async function migrateHistoryMemosToCore(
  sessions: readonly { id: string; memo: string | null }[],
  setCoreMemo: (id: string, memo: string) => Promise<void>,
  eraseHistoryMemo: (id: string, text: string) => Promise<string> = setSessionMemo,
): Promise<number> {
  await sessionMemosHydrated;
  const candidates = sessions.flatMap((session) => {
    const memo = sessionMemos.get(session.id);
    return memo ? [{ id: session.id, memo, alreadyInCore: !!session.memo }] : [];
  });
  const migrated = await Promise.allSettled(
    candidates.map(async ({ id, memo, alreadyInCore }) => {
      if (!alreadyInCore) await setCoreMemo(id, memo);
      await eraseHistoryMemo(id, "");
      return !alreadyInCore;
    }),
  );
  return migrated.filter((result) => result.status === "fulfilled" && result.value).length;
}

export async function handoffCoreMemoToHistory(
  session: { id: string; memo: string | null; resumeSource: string | null },
  persistHistoryMemo: (id: string, text: string) => Promise<string> = setSessionMemo,
): Promise<void> {
  await persistHistoryMemo(session.resumeSource ?? session.id, session.memo ?? "");
}
