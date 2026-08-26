// UI activity and notification state. This module never creates, stops, deletes, retains, or
// releases a Core session/viewer; it only derives display state from agent/shell events.
import { activity, claimActivityOwnership, isFailedWorker, lastPrompts, lastResponses, persistActivityState } from "./registry.js";
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

export const SESSIONS_CHANNEL = "sessions";

export interface ActivityServiceDeps {
  publish: (channel: string, data: unknown) => void;
  forgetWorkPhase: (id: string) => void;
  coreMetadataOf: (id: string) => ActivityMetadata | null | Promise<ActivityMetadata | null>;
  notifyMobileWebPushActivity?: (notification: MobileWebPushActivityNotification) => void;
}

type ActivityFlag = "working" | "waiting";
type ActivityMetadata = { cwd: string; agent: LaunchAgent };

function refreshLastResponse(id: string, cwd: string): void {
  const text = readLatestResponse(id, cwd);
  if (text) lastResponses.set(id, text);
}

function withActivityMetadata(deps: ActivityServiceDeps, id: string, use: (metadata: { cwd: string | null; agent: LaunchAgent | null }) => void): void {
  const core = deps.coreMetadataOf(id);
  if (!(core instanceof Promise)) return use({ cwd: core?.cwd ?? null, agent: core?.agent ?? null });
  void core.then(
    (metadata) => use({ cwd: metadata?.cwd ?? null, agent: metadata?.agent ?? null }),
    () => use({ cwd: null, agent: null }),
  );
}

export function createSessionActivity(deps: ActivityServiceDeps) {
  const mobileWebPushActivityState: MobileWebPushActivityState = new Map();

  function publishActivity(id: string, terminal?: { failed: boolean }, afterMetadata?: (agent: LaunchAgent | null) => void): void {
    const current = activity.get(id);
    withActivityMetadata(deps, id, ({ cwd, agent }) => {
      if (shouldRefreshReply(current, cwd, clearedTranscripts.has(id))) refreshLastResponse(id, cwd);
      deps.publish(SESSIONS_CHANNEL, {
        ...sessionRow(id, current, cwd, {
          lastPrompt: lastPrompts.get(id),
          lastResponse: lastResponses.get(id),
        }),
        ...terminal,
      });
      afterMetadata?.(agent);
    });
  }

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
    claimActivityOwnership(id);
    publishActivity(id, undefined, (agent) => notifyTransition(id, prev, next, event, agent));
    persistActivityState();
  }

  function endSessionActivity(id: string, event = "exited"): void {
    const prev = activity.get(id);
    const next = { ...prev, working: false, waiting: false, event, at: Date.now() };
    activity.set(id, next);
    claimActivityOwnership(id);
    publishActivity(id, { failed: isFailedWorker(id) });
    activity.delete(id);
    persistActivityState();
    forgetMobileWebPushActivitySession(mobileWebPushActivityState, id);
    deps.forgetWorkPhase(id);
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
