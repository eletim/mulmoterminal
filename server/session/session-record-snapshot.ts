import {
  buildSessionRecords,
  selectCurrentTerminalSessionRecords,
  selectUnplacedSessionRecords,
  type ActivityRecordSource,
  type KnownSessionRecordSource,
  type LiveSessionRecordSource,
  type SessionRecord,
} from "./session-records.js";
import { sessionDisplayName } from "../../common/sessionMemo.js";
import {
  activity,
  activityStateHydrated,
  aiTitles,
  antigravityConversationsHydrated,
  backgroundSessionsHydrated,
  codexRolloutIds,
  codexRolloutIdsHydrated,
  devTerminalCwdsHydrated,
  devTerminalSessionsHydrated,
  knownSessions,
  lastPrompts,
  placedSessionsHydrated,
  ptys,
  sessionRecordRegistrySnapshot,
  sessionMemos,
  sessionMemosHydrated,
  unplacedSessionsHydrated,
} from "./registry.js";
import {
  deletedSessionRecordIds,
  deletedSessionRecordsHydrated,
  sessionLifecycleRecordRows,
  sessionLifecycleRecordsHydrated,
} from "./session-lifecycle-records.js";
import { hydrateTmuxSurvivorRecordSources } from "./tmux-survivor-records.js";

export interface CurrentSessionRecordOptions {
  ids?: readonly string[];
  tmuxIds?: readonly string[];
  now?: number;
  paneCommandOf?: (id: string) => string | null;
  claudeTranscriptExists?: (id: string, cwd: string) => boolean;
}

export interface CurrentTerminalSessionRecordSources {
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
    devTerminalCwdsHydrated,
    devTerminalSessionsHydrated,
    sessionLifecycleRecordsHydrated,
    deletedSessionRecordsHydrated,
    unplacedSessionsHydrated,
    placedSessionsHydrated,
    backgroundSessionsHydrated,
    sessionMemosHydrated,
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

function titleSources(ids: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) {
    const title = sessionDisplayName(sessionMemos.get(id), aiTitles.get(id), lastPrompts.get(id), knownSessions.get(id)?.title);
    if (title) out.set(id, title);
  }
  return out;
}

function tmuxClaudeTranscriptIds(
  tmuxIds: readonly string[],
  cwdBySession: ReadonlyMap<string, string>,
  exists: CurrentSessionRecordOptions["claudeTranscriptExists"],
): string[] {
  if (!exists) return [];
  return tmuxIds.filter((id) => {
    const cwd = cwdBySession.get(id);
    return !!cwd && exists(id, cwd);
  });
}

function recordsFromSnapshot(
  registry: RegistrySnapshot,
  { ids, tmuxIds = [], now = Date.now(), paneCommandOf, claudeTranscriptExists }: CurrentSessionRecordOptions = {},
): SessionRecord[] {
  const live = liveSessionSources();
  const liveIds = new Set(live.map((entry) => entry.id));
  const claudeTranscriptIds = tmuxClaudeTranscriptIds(tmuxIds, registry.cwdBySession, claudeTranscriptExists);
  return buildSessionRecords({
    ...(ids !== undefined ? { ids } : {}),
    now,
    deletedIds: [...deletedSessionRecordIds],
    live,
    tmuxIds,
    tmuxSurvivors: hydrateTmuxSurvivorRecordSources({
      tmuxIds,
      liveIds,
      cwdBySession: registry.cwdBySession,
      titleBySession: titleSources(tmuxIds),
      antigravityConversations: registry.antigravityConversations,
      now,
      ...(paneCommandOf ? { paneCommandOf } : {}),
    }),
    known: knownSessionSources(),
    lifecycle: sessionLifecycleRecordRows(),
    activity: activitySources(),
    claudeTranscriptIds,
    codexRolloutIds,
    ...registry,
  });
}

export function currentSessionRecords(options: CurrentSessionRecordOptions = {}): SessionRecord[] {
  return recordsFromSnapshot(sessionRecordRegistrySnapshot(), options);
}

export function currentTerminalSessionRecords(options: CurrentSessionRecordOptions = {}): SessionRecord[] {
  return selectCurrentTerminalSessionRecords(recordsFromSnapshot(sessionRecordRegistrySnapshot(), options));
}

export function currentUnplacedSessionRecords(options: CurrentSessionRecordOptions = {}): SessionRecord[] {
  const registry = sessionRecordRegistrySnapshot();
  return selectUnplacedSessionRecords(currentTerminalSessionRecords({ ...options, ids: registry.unplaced.map((record) => record.id) }));
}

export function currentTerminalSessionRecordSources(options: CurrentSessionRecordOptions = {}): CurrentTerminalSessionRecordSources {
  const records = currentTerminalSessionRecords(options);
  const orderedRecords = records.toSorted((a, b) => b.updatedAt - a.updatedAt);
  const recordById = new Map(orderedRecords.map((record) => [record.id, record]));
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
