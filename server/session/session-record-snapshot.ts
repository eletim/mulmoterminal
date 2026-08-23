import {
  buildSessionRecords,
  selectCurrentMobileCandidateRecords,
  selectUnplacedSessionRecords,
  type ActivityRecordSource,
  type KnownSessionRecordSource,
  type LiveSessionRecordSource,
  type SessionRecord,
} from "./session-records.js";
import {
  activity,
  activityStateHydrated,
  antigravityConversationsHydrated,
  backgroundSessionsHydrated,
  codexRolloutIds,
  codexRolloutIdsHydrated,
  devTerminalSessionsHydrated,
  knownSessions,
  placedSessionsHydrated,
  ptys,
  sessionRecordRegistrySnapshot,
  unplacedSessionsHydrated,
} from "./registry.js";

export const MOBILE_SESSION_ACTIVITY_CANDIDATE_LIMIT = 50;

export interface CurrentSessionRecordOptions {
  ids?: readonly string[];
  tmuxIds?: readonly string[];
  now?: number;
  activityCandidateLimit?: number;
}

export interface CurrentMobileSessionRecordSources {
  recordById: Map<string, SessionRecord>;
  ids: string[];
  liveIds: string[];
  tmuxIds: string[];
  candidateIds: string[];
}

type RegistrySnapshot = ReturnType<typeof sessionRecordRegistrySnapshot>;

export async function hydrateSessionRecordSnapshotInputs(): Promise<void> {
  await Promise.all([
    activityStateHydrated,
    devTerminalSessionsHydrated,
    unplacedSessionsHydrated,
    placedSessionsHydrated,
    backgroundSessionsHydrated,
    antigravityConversationsHydrated,
    codexRolloutIdsHydrated,
  ]);
}

function liveSessionSources(): LiveSessionRecordSource[] {
  return [...ptys].map(([id, entry]) => ({
    id,
    cwd: entry.cwd,
    agent: entry.agent,
    attached: entry.ws !== null,
    ...(entry.tmux ? { tmux: true } : {}),
  }));
}

function knownSessionSources(): KnownSessionRecordSource[] {
  return [...knownSessions].map(([id, session]) => ({ id, ...session }));
}

function activitySources(): ActivityRecordSource[] {
  return [...activity].map(([id, value]) => ({ id, ...value }));
}

function activeActivityIds(): string[] {
  return [...activity].filter(([, value]) => value.working || value.waiting).map(([id]) => id);
}

function recordsFromSnapshot(registry: RegistrySnapshot, { ids, tmuxIds = [], now = Date.now() }: CurrentSessionRecordOptions = {}): SessionRecord[] {
  return buildSessionRecords({
    ...(ids !== undefined ? { ids } : {}),
    now,
    live: liveSessionSources(),
    tmuxIds,
    known: knownSessionSources(),
    activity: activitySources(),
    codexRolloutIds,
    ...registry,
  });
}

export function currentSessionRecords(options: CurrentSessionRecordOptions = {}): SessionRecord[] {
  return recordsFromSnapshot(sessionRecordRegistrySnapshot(), options);
}

export function currentUnplacedSessionRecords(options: CurrentSessionRecordOptions = {}): SessionRecord[] {
  const registry = sessionRecordRegistrySnapshot();
  return selectUnplacedSessionRecords(recordsFromSnapshot(registry, { ...options, ids: registry.unplaced.map((record) => record.id) }));
}

export function currentMobileSessionRecordSources(options: CurrentSessionRecordOptions = {}): CurrentMobileSessionRecordSources {
  const registry = sessionRecordRegistrySnapshot();
  const runtimeIds = [...new Set([...ptys.keys(), ...(options.tmuxIds ?? []), ...activeActivityIds()])];
  const activityLimit = options.activityCandidateLimit ?? MOBILE_SESSION_ACTIVITY_CANDIDATE_LIMIT;
  const records = selectCurrentMobileCandidateRecords(recordsFromSnapshot(registry, { ...options, ids: runtimeIds }));
  const activityCandidates = records
    .filter((record) => !record.runtime.pty && !record.runtime.tmux)
    .sort((a, b) => (b.activity.at ?? 0) - (a.activity.at ?? 0))
    .slice(0, activityLimit);
  const recordById = new Map(
    [...records.filter((record) => record.runtime.pty), ...records.filter((record) => record.runtime.tmux), ...activityCandidates].map((record) => [
      record.id,
      record,
    ]),
  );
  const ids = [...recordById.keys()];
  return {
    recordById,
    ids,
    liveIds: ids.filter((id) => recordById.get(id)?.runtime.pty),
    tmuxIds: ids.filter((id) => recordById.get(id)?.runtime.tmux),
    candidateIds: ids.filter((id) => {
      const record = recordById.get(id);
      return record ? !record.runtime.pty && !record.runtime.tmux : false;
    }),
  };
}
