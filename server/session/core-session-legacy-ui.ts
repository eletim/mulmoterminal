import { coreSessions } from "./core-session-adapter.js";
import { sessionMemos, sessionMemosHydrated } from "./registry.js";

/** One-way UI-data migration. This never decides membership; the Core session exists first. */
export async function migrateLegacyMemoToCore(sessionId: string): Promise<void> {
  await sessionMemosHydrated;
  const memo = sessionMemos.get(sessionId);
  if (memo) await coreSessions.setMemo(sessionId, memo);
}

export function legacyMemoForCoreSession(sessionId: string): string | undefined {
  return sessionMemos.get(sessionId);
}

export const legacySessionMemosHydrated = sessionMemosHydrated;
