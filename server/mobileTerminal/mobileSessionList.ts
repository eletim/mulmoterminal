import type { SessionAgent } from "../../common/sessionAgent.js";

export function idsNeedingPersistentDetail(ids: readonly string[], memoryTitleOf: (id: string) => string): string[] {
  return ids.filter((id) => memoryTitleOf(id) === "");
}

export interface MobilePersistentDetail {
  title: string;
  cwd: string | null;
  agent: SessionAgent | null;
}

export interface PersistentMobileDetailSources {
  rolloutIdOf: (id: string) => string | undefined;
  readCodex: (rolloutId: string) => Promise<{ title: string; cwd?: string | null } | null>;
  readClaude: (id: string, cwd: string) => Promise<{ title: string } | null>;
}

export async function persistentMobileDetail(id: string, cwdHint: string, sources: PersistentMobileDetailSources): Promise<MobilePersistentDetail | null> {
  const rolloutId = sources.rolloutIdOf(id);
  if (rolloutId) {
    const codex = await sources.readCodex(rolloutId).catch(() => null);
    if (codex?.title) return { title: codex.title, cwd: codex.cwd ?? (cwdHint || null), agent: "codex" };
  }
  if (!cwdHint) return null;
  const claude = await sources.readClaude(id, cwdHint).catch(() => null);
  return claude?.title ? { title: claude.title, cwd: cwdHint, agent: "claude" } : null;
}

export async function persistentMobileDetails(
  ids: readonly string[],
  cwdOfSession: (id: string) => string,
  sources: PersistentMobileDetailSources,
): Promise<Map<string, MobilePersistentDetail>> {
  const entries = await Promise.all(ids.map(async (id) => [id, await persistentMobileDetail(id, cwdOfSession(id), sources)] as const));
  return new Map(entries.filter((entry): entry is readonly [string, MobilePersistentDetail] => entry[1] !== null));
}
