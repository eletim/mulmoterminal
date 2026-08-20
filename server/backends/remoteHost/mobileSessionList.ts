import type { SessionAgent } from "../../../common/sessionAgent.js";

export const MOBILE_ACTIVITY_CANDIDATE_LIMIT = 50;

export interface MobileActivityCandidateInput {
  liveIds: readonly string[];
  tmuxIds: readonly string[];
  activityEntries: Iterable<readonly [string, { working?: boolean; waiting?: boolean; at?: number }]>;
  isGridSession: (id: string) => boolean;
  limit?: number;
}

export function mobileActivityCandidateIds({
  liveIds,
  tmuxIds,
  activityEntries,
  isGridSession,
  limit = MOBILE_ACTIVITY_CANDIDATE_LIMIT,
}: MobileActivityCandidateInput): string[] {
  const alreadyListed = new Set([...liveIds, ...tmuxIds]);
  return [...activityEntries]
    .filter(([id, a]) => !alreadyListed.has(id) && isGridSession(id) && (a.working || a.waiting))
    .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
    .slice(0, limit)
    .map(([id]) => id);
}

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

export async function persistentMobileDetail(
  id: string,
  cwdHint: string,
  sources: PersistentMobileDetailSources,
): Promise<MobilePersistentDetail | null> {
  const rolloutId = sources.rolloutIdOf(id);
  if (rolloutId) {
    const codex = await sources.readCodex(rolloutId);
    if (codex?.title) return { title: codex.title, cwd: codex.cwd ?? (cwdHint || null), agent: "codex" };
  }
  if (!cwdHint) return null;
  const claude = await sources.readClaude(id, cwdHint);
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
