// UI activity and notification state. This module never creates, stops, deletes, retains, or
// releases a Core session/viewer; it only derives display state from agent/shell events.
import { activity, lastPrompts, lastResponses } from "./activity-store.js";
import { isFailedWorkerHistory } from "./history-state.js";
import { clearedTranscripts } from "./cleared-transcripts.js";
import { nextActivity, sessionRow, shouldRefreshReply } from "./activity-transition.js";
import { readLatestResponse } from "./session-reads.js";
import { messageOf } from "../errors.js";
import type { LaunchAgent } from "../../common/launchAgent.js";
import {
  forgetMobileWebPushActivitySession,
  mobileWebPushKindForActivityTransition,
  type MobileWebPushActivityNotification,
  type MobileWebPushActivityState,
} from "../mobile-web-push/activity-notifier.js";
import { versionSessionStateUpdate } from "./session-state-revision.js";

export const SESSIONS_CHANNEL = "sessions";

export interface ActivityServiceDeps {
  publish: (channel: string, data: unknown) => void;
  forgetWorkPhase: (id: string) => void;
  coreMetadataOf: (id: string) => ActivityMetadata | null | Promise<ActivityMetadata | null>;
  notifyMobileWebPushActivity?: (notification: MobileWebPushActivityNotification) => void;
  workPhaseOf?: (id: string) => import("./workPhase.js").WorkPhase | null;
  sessionExtrasOf?: (id: string, cwd: string) => Promise<{ usage: unknown; context: unknown }>;
}

type ActivityFlag = "working" | "waiting";
type ActivityMetadata = { cwd: string; agent: LaunchAgent };

function refreshLastResponse(id: string, cwd: string): void {
  const text = readLatestResponse(id, cwd);
  if (text) lastResponses.set(id, text);
}

function forgetActivityDisplayState(id: string): void {
  activity.delete(id);
  lastPrompts.delete(id);
  lastResponses.delete(id);
}

function withActivityMetadata(deps: ActivityServiceDeps, id: string, use: (metadata: { cwd: string | null; agent: LaunchAgent | null }) => void): void {
  const core = deps.coreMetadataOf(id);
  if (!(core instanceof Promise)) return use({ cwd: core?.cwd ?? null, agent: core?.agent ?? null });
  void core.then(
    (metadata) => use({ cwd: metadata?.cwd ?? null, agent: metadata?.agent ?? null }),
    () => use({ cwd: null, agent: null }),
  );
}

function createSessionStatePublisher(deps: ActivityServiceDeps) {
  const publishTokens = new Map<string, symbol>();
  const lastExtras = new Map<string, string>();
  const lastRows = new Map<string, string>();
  const isCurrent = (id: string, token: symbol): boolean => Object.is(publishTokens.get(id), token);

  function forget(id: string): void {
    publishTokens.delete(id);
    lastExtras.delete(id);
    lastRows.delete(id);
  }

  function publishSessionExtras(id: string, cwd: string | null, token: symbol, forgetAfter: boolean): void {
    if (!cwd || !deps.sessionExtrasOf) {
      if (forgetAfter && isCurrent(id, token)) forget(id);
      return;
    }
    void deps
      .sessionExtrasOf(id, cwd)
      .then((extras) => {
        if (!isCurrent(id, token)) return;
        const fingerprint = JSON.stringify(extras);
        if (lastExtras.get(id) === fingerprint) return;
        lastExtras.set(id, fingerprint);
        deps.publish(SESSIONS_CHANNEL, versionSessionStateUpdate(id, { id, ...extras }));
      })
      .catch(() => {})
      .finally(() => {
        if (forgetAfter && isCurrent(id, token)) forget(id);
      });
  }

  function publishActivity(id: string, terminal?: { failed: boolean }, afterMetadata?: (agent: LaunchAgent | null) => void, forgetAfter = false): void {
    const current = activity.get(id);
    const token = Symbol(id);
    publishTokens.set(id, token);
    withActivityMetadata(deps, id, ({ cwd, agent }) => {
      if (isCurrent(id, token)) {
        if (shouldRefreshReply(current, cwd, clearedTranscripts.has(id))) refreshLastResponse(id, cwd);
        const row = {
          ...sessionRow(id, current, cwd, {
            lastPrompt: lastPrompts.get(id),
            lastResponse: lastResponses.get(id),
          }),
          workPhase: deps.workPhaseOf?.(id) ?? null,
          ...terminal,
        };
        const fingerprint = JSON.stringify(row);
        if (lastRows.get(id) !== fingerprint) {
          lastRows.set(id, fingerprint);
          deps.publish(SESSIONS_CHANNEL, versionSessionStateUpdate(id, row));
        }
        publishSessionExtras(id, cwd, token, forgetAfter);
      }
      afterMetadata?.(agent);
    });
  }

  const publishFinalActivity = (id: string, terminal: { failed: boolean }): void => publishActivity(id, terminal, undefined, true);
  return { publishActivity, publishFinalActivity };
}

export function createSessionActivity(deps: ActivityServiceDeps) {
  const mobileWebPushActivityState: MobileWebPushActivityState = new Map();
  const statePublisher = createSessionStatePublisher(deps);
  const publishActivity = statePublisher.publishActivity;

  function notifyTransition(
    id: string,
    prev: Parameters<typeof mobileWebPushKindForActivityTransition>[2],
    next: Parameters<typeof mobileWebPushKindForActivityTransition>[3],
    event: string | undefined,
    agent: LaunchAgent | null,
  ): void {
    const kind = mobileWebPushKindForActivityTransition(mobileWebPushActivityState, id, prev, next, event);
    if (!kind) return;
    try {
      deps.notifyMobileWebPushActivity?.({ kind, sessionId: id, agent });
    } catch (err) {
      console.warn(`[mobile-web-push] activity notification dropped for ${id}: ${messageOf(err)}`);
    }
  }

  function setFlag(id: string, flag: ActivityFlag, value: boolean, event?: string): void {
    const prev = activity.get(id);
    const next = nextActivity(prev, flag === "working" ? { working: value } : { waiting: value }, event, Date.now());
    if (!next) return;
    activity.set(id, next);
    publishActivity(id, undefined, (agent) => notifyTransition(id, prev, next, event, agent));
  }

  function endSessionActivity(id: string, event = "exited"): void {
    const prev = activity.get(id);
    const next = { ...prev, working: false, waiting: false, event, at: Date.now() };
    activity.set(id, next);
    deps.forgetWorkPhase(id);
    statePublisher.publishFinalActivity(id, { failed: isFailedWorkerHistory(id) });
    forgetActivityDisplayState(id);
    forgetMobileWebPushActivitySession(mobileWebPushActivityState, id);
  }

  return {
    refreshLastResponse,
    publishActivity,
    acknowledgeShellDone: (id: string) => setFlag(id, "waiting", false),
    setWorking: (id: string, working: boolean, event?: string) => setFlag(id, "working", working, event),
    setWaiting: (id: string, waiting: boolean, event?: string) => setFlag(id, "waiting", waiting, event),
    endSessionActivity,
  };
}
