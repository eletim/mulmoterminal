import type { SessionAgent } from "../../common/sessionAgent.js";
import type { LaunchAgent } from "../../common/launchAgent.js";
import type { Activity, KnownSession } from "./types.js";

export type SessionRecordLifecycle = "starting" | "live" | "detached" | "stopped" | "failed";
export type SessionRecordVisibility = "grid" | "history" | "background" | "internal";

export interface SessionRecordRuntime {
  pty: boolean;
  tmux: boolean;
  attached: boolean;
}

export interface SessionRecordResume {
  claudeTranscript: boolean;
  codexRolloutId: string | null;
  antigravityConversationId: string | null;
}

export interface SessionRecordPlacement {
  gridCell: boolean;
  unplaced: boolean;
  placed: boolean;
}

export interface SessionRecordActivity {
  working: boolean;
  waiting: boolean;
  event: string | null;
  at: number | null;
}

export interface SessionRecord {
  id: string;
  agent: SessionAgent | null;
  cwd: string | null;
  title: string | null;
  visibility: SessionRecordVisibility;
  lifecycle: SessionRecordLifecycle;
  runtime: SessionRecordRuntime;
  resume: SessionRecordResume;
  placement: SessionRecordPlacement;
  activity: SessionRecordActivity;
  createdAt: number | null;
  updatedAt: number;
}

export interface LiveSessionRecordSource {
  id: string;
  cwd: string;
  agent: SessionAgent;
  tmux?: boolean;
  attached?: boolean;
}

export interface KnownSessionRecordSource extends KnownSession {
  id: string;
}

export interface ActivityRecordSource extends Activity {
  id: string;
}

export interface UnplacedSessionRecordSource {
  id: string;
  agent: LaunchAgent;
}

export interface AntigravityConversationRecordSource {
  sessionId: string;
  conversationId: string;
  cwd: string;
  startedAt: number;
}

export interface LifecycleSessionRecordSource {
  id: string;
  lifecycle: SessionRecordLifecycle;
  agent: SessionAgent | null;
  cwd: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TmuxSurvivorSessionRecordSource {
  id: string;
  agent: SessionAgent | null;
  cwd: string | null;
  title: string | null;
  createdAt: number | null;
  updatedAt: number;
}

export interface SessionRecordInput {
  ids?: readonly string[];
  lifecycle?: readonly LifecycleSessionRecordSource[];
  tmuxSurvivors?: readonly TmuxSurvivorSessionRecordSource[];
  now?: number;
  live?: readonly LiveSessionRecordSource[];
  tmuxIds?: readonly string[];
  known?: readonly KnownSessionRecordSource[];
  activity?: readonly ActivityRecordSource[];
  devTerminalIds?: readonly string[];
  unplaced?: readonly UnplacedSessionRecordSource[];
  placedIds?: readonly string[];
  backgroundIds?: readonly string[];
  internalIds?: readonly string[];
  failedIds?: readonly string[];
  cwdBySession?: ReadonlyMap<string, string>;
  claudeTranscriptIds?: readonly string[];
  codexRolloutIds?: ReadonlyMap<string, string>;
  antigravityConversations?: readonly AntigravityConversationRecordSource[];
}

const EMPTY_ACTIVITY: SessionRecordActivity = { working: false, waiting: false, event: null, at: null };

function idSet(ids: readonly string[] | undefined): Set<string> {
  return new Set(ids ?? []);
}

function addAll(ids: Set<string>, values: Iterable<string>): void {
  for (const id of values) ids.add(id);
}

export function activeSessionRecordLifecycle(lifecycle: SessionRecordLifecycle): boolean {
  return lifecycle === "starting" || lifecycle === "live" || lifecycle === "detached";
}

function hasResume(record: Pick<SessionRecord, "resume">): boolean {
  return record.resume.claudeTranscript || record.resume.codexRolloutId !== null || record.resume.antigravityConversationId !== null;
}

function lifecycleFor(input: {
  failed: boolean;
  live: LiveSessionRecordSource | undefined;
  tmux: boolean;
  known: KnownSessionRecordSource | undefined;
  activity: SessionRecordActivity;
  lifecycle: LifecycleSessionRecordSource | undefined;
}): SessionRecordLifecycle {
  if (input.failed) return "failed";
  if (input.live) return input.live.attached === false ? "detached" : "live";
  if (input.tmux) return "detached";
  if (input.lifecycle) return input.lifecycle.lifecycle;
  if (input.known) return "starting";
  return "stopped";
}

function visibilityFor(input: { internal: boolean; background: boolean; grid: boolean }): SessionRecordVisibility {
  if (input.internal) return "internal";
  if (input.background) return "background";
  return input.grid ? "grid" : "history";
}

function recordUpdatedAt(input: {
  live: LiveSessionRecordSource | undefined;
  known: KnownSessionRecordSource | undefined;
  activity: SessionRecordActivity;
  antigravity: AntigravityConversationRecordSource | undefined;
  lifecycle: LifecycleSessionRecordSource | undefined;
  tmuxSurvivor: TmuxSurvivorSessionRecordSource | undefined;
  now: number;
}): number {
  return Math.max(
    input.activity.at ?? 0,
    input.known?.createdAt ?? 0,
    input.antigravity?.startedAt ?? 0,
    input.lifecycle?.updatedAt ?? 0,
    input.tmuxSurvivor?.updatedAt ?? 0,
    input.live ? input.now : 0,
  );
}

function agentFor(input: {
  live: LiveSessionRecordSource | undefined;
  lifecycle: LifecycleSessionRecordSource | undefined;
  unplaced: UnplacedSessionRecordSource | undefined;
  codexRolloutId: string | undefined;
  antigravity: AntigravityConversationRecordSource | undefined;
  claudeTranscript: boolean;
  tmuxSurvivor: TmuxSurvivorSessionRecordSource | undefined;
}): SessionAgent | null {
  if (input.live) return input.live.agent;
  if (input.lifecycle?.agent) return input.lifecycle.agent;
  if (input.unplaced) return input.unplaced.agent;
  if (input.codexRolloutId) return "codex";
  if (input.antigravity) return "antigravity";
  if (input.claudeTranscript) return "claude";
  if (input.tmuxSurvivor?.agent) return input.tmuxSurvivor.agent;
  return null;
}

function cwdFor(input: {
  live: LiveSessionRecordSource | undefined;
  lifecycle: LifecycleSessionRecordSource | undefined;
  remembered: string | undefined;
  antigravity: AntigravityConversationRecordSource | undefined;
  tmuxSurvivor: TmuxSurvivorSessionRecordSource | undefined;
}): string | null {
  return input.live?.cwd ?? input.lifecycle?.cwd ?? input.remembered ?? input.antigravity?.cwd ?? input.tmuxSurvivor?.cwd ?? null;
}

interface SessionRecordLookup {
  liveById: Map<string, LiveSessionRecordSource>;
  knownById: Map<string, KnownSessionRecordSource>;
  lifecycleById: Map<string, LifecycleSessionRecordSource>;
  tmuxSurvivorById: Map<string, TmuxSurvivorSessionRecordSource>;
  activityById: Map<string, ActivityRecordSource>;
  unplacedById: Map<string, UnplacedSessionRecordSource>;
  antigravityById: Map<string, AntigravityConversationRecordSource>;
  tmuxIds: Set<string>;
  devTerminalIds: Set<string>;
  placedIds: Set<string>;
  backgroundIds: Set<string>;
  internalIds: Set<string>;
  failedIds: Set<string>;
  claudeTranscriptIds: Set<string>;
  codexRolloutIds: ReadonlyMap<string, string>;
}

function sessionRecordLookup(input: SessionRecordInput): SessionRecordLookup {
  return {
    liveById: new Map((input.live ?? []).map((entry) => [entry.id, entry])),
    knownById: new Map((input.known ?? []).map((entry) => [entry.id, entry])),
    lifecycleById: new Map((input.lifecycle ?? []).map((entry) => [entry.id, entry])),
    tmuxSurvivorById: new Map((input.tmuxSurvivors ?? []).map((entry) => [entry.id, entry])),
    activityById: new Map((input.activity ?? []).map((entry) => [entry.id, entry])),
    unplacedById: new Map((input.unplaced ?? []).map((entry) => [entry.id, entry])),
    antigravityById: new Map((input.antigravityConversations ?? []).map((entry) => [entry.sessionId, entry])),
    tmuxIds: idSet(input.tmuxIds),
    devTerminalIds: idSet(input.devTerminalIds),
    placedIds: idSet(input.placedIds),
    backgroundIds: idSet(input.backgroundIds),
    internalIds: idSet(input.internalIds),
    failedIds: idSet(input.failedIds),
    claudeTranscriptIds: idSet(input.claudeTranscriptIds),
    codexRolloutIds: input.codexRolloutIds ?? new Map<string, string>(),
  };
}

function sessionRecordIds(source: SessionRecordLookup, explicitIds: readonly string[] | undefined): Set<string> {
  if (explicitIds) return new Set(explicitIds);
  const ids = new Set<string>();
  addAll(ids, source.liveById.keys());
  addAll(ids, source.tmuxIds);
  addAll(ids, source.knownById.keys());
  addAll(ids, source.lifecycleById.keys());
  addAll(ids, source.tmuxSurvivorById.keys());
  addAll(ids, source.activityById.keys());
  addAll(ids, source.devTerminalIds);
  addAll(ids, source.unplacedById.keys());
  addAll(ids, source.placedIds);
  addAll(ids, source.backgroundIds);
  addAll(ids, source.internalIds);
  addAll(ids, source.failedIds);
  addAll(ids, source.claudeTranscriptIds);
  addAll(ids, source.codexRolloutIds.keys());
  addAll(ids, source.antigravityById.keys());
  return ids;
}

function activityFor(raw: ActivityRecordSource | undefined): SessionRecordActivity {
  return raw ? { working: !!raw.working, waiting: !!raw.waiting, event: raw.event ?? null, at: raw.at ?? null } : EMPTY_ACTIVITY;
}

function placementFor(id: string, source: SessionRecordLookup): SessionRecordPlacement {
  const unplaced = source.unplacedById.has(id) && !source.placedIds.has(id);
  return { gridCell: source.devTerminalIds.has(id), unplaced, placed: source.placedIds.has(id) };
}

function resumeFor(
  id: string,
  codexRolloutId: string | undefined,
  antigravity: AntigravityConversationRecordSource | undefined,
  source: SessionRecordLookup,
): SessionRecordResume {
  return {
    claudeTranscript: source.claudeTranscriptIds.has(id),
    codexRolloutId: codexRolloutId ?? null,
    antigravityConversationId: antigravity?.conversationId ?? null,
  };
}

function buildSessionRecord(id: string, source: SessionRecordLookup, input: SessionRecordInput): SessionRecord {
  const live = source.liveById.get(id);
  const known = source.knownById.get(id);
  const lifecycle = source.lifecycleById.get(id);
  const tmuxSurvivor = source.tmuxSurvivorById.get(id);
  const activity = activityFor(source.activityById.get(id));
  const unplaced = source.unplacedById.get(id);
  const antigravity = source.antigravityById.get(id);
  const codexRolloutId = source.codexRolloutIds.get(id);
  const resume = resumeFor(id, codexRolloutId, antigravity, source);
  const placement = placementFor(id, source);
  const tmux = source.tmuxIds.has(id) || !!live?.tmux;
  return {
    id,
    agent: agentFor({ live, lifecycle, unplaced, codexRolloutId, antigravity, claudeTranscript: resume.claudeTranscript, tmuxSurvivor }),
    cwd: cwdFor({ live, lifecycle, remembered: input.cwdBySession?.get(id), antigravity, tmuxSurvivor }),
    title: known?.title ?? tmuxSurvivor?.title ?? null,
    visibility: visibilityFor({
      internal: source.internalIds.has(id),
      background: source.backgroundIds.has(id),
      grid: placement.gridCell || placement.unplaced,
    }),
    lifecycle: lifecycleFor({ failed: source.failedIds.has(id), live, tmux, known, activity, lifecycle }),
    runtime: { pty: !!live, tmux, attached: live?.attached !== false && !!live },
    resume,
    placement,
    activity,
    createdAt: known?.createdAt ?? lifecycle?.createdAt ?? antigravity?.startedAt ?? tmuxSurvivor?.createdAt ?? null,
    updatedAt: recordUpdatedAt({ live, known, activity, antigravity, lifecycle, tmuxSurvivor, now: input.now ?? 0 }),
  };
}

export function buildSessionRecords(input: SessionRecordInput): SessionRecord[] {
  const source = sessionRecordLookup(input);
  return [...sessionRecordIds(source, input.ids)].map((id) => buildSessionRecord(id, source, input));
}

export function selectGridVisibleSessionRecords(records: readonly SessionRecord[]): SessionRecord[] {
  return records.filter((record) => record.visibility === "grid" && activeSessionRecordLifecycle(record.lifecycle));
}

export function selectHistorySessionRecords(records: readonly SessionRecord[]): SessionRecord[] {
  return records.filter((record) => record.visibility === "history" && hasResume(record));
}

export function selectBackgroundSessionRecords(records: readonly SessionRecord[]): SessionRecord[] {
  return records.filter((record) => record.visibility === "background");
}

export function selectInternalSessionRecords(records: readonly SessionRecord[]): SessionRecord[] {
  return records.filter((record) => record.visibility === "internal");
}

export function selectUnplacedSessionRecords(records: readonly SessionRecord[]): SessionRecord[] {
  return records.filter((record) => record.visibility === "grid" && record.placement.unplaced && activeSessionRecordLifecycle(record.lifecycle));
}

export function selectCurrentPcGridCandidateIds(records: readonly SessionRecord[], persistedCellSessionIds: readonly string[]): string[] {
  return [...new Set([...persistedCellSessionIds, ...selectUnplacedSessionRecords(records).map((record) => record.id)])];
}

export function selectCurrentMobileCandidateRecords(records: readonly SessionRecord[]): SessionRecord[] {
  return records.filter((record) => record.visibility === "grid" && activeSessionRecordLifecycle(record.lifecycle));
}
