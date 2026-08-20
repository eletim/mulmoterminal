// When a session dies, and who is told about its state.
//
// The last stateful thing index.ts owned. The DECISIONS inside were extracted and tested
// earlier (#548): reapDecisionFor picks the grace window, shouldForgetActivity decides what
// survives a teardown, nextActivity folds a flag change. What was left is the part that holds
// timers and calls them in the right order — which is exactly the part that could not be
// reached without booting the server.
//
// Three things arrive as deps rather than imports, for the same reason each did in index.ts:
//
//   publish — pub/sub only exists once the HTTP server does, and this is built before it.
//   forgetTitle — the title manager needs publishActivity, and reap needs forgetTitle. The
//     cycle is real; binding it late is how index.ts already broke it.
// Everything else is the shared session registry, which is imported directly.
import {
  activity,
  aiTitles,
  hiddenSessions,
  knownSessions,
  lastPrompts,
  lastResponses,
  lastTitleAttemptMs,
  claimActivityOwnership,
  lastTitledUserTurns,
  launchChoices,
  persistActivityState,
  ptys,
  sessionMemos,
  titleInFlight,
  isFailedWorker,
} from "./registry.js";
import { clearedTranscripts, forgetClearedTranscript } from "./cleared-transcripts.js";
import { parseWaitGraceMs, reapDecisionFor, reapTimerDelay, shouldForgetActivity } from "./reap-policy.js";
import { sessionRow, shouldRefreshReply } from "./activity-transition.js";
import { flagEffect, type ActivityFlag } from "./activity-flag.js";
import type { WorkPhase } from "./workPhase.js";
import { readLatestResponse } from "./session-reads.js";
import { cleanupSessionSettings } from "./session-settings.js";
import { cleanupSessionDrops } from "./session-drops.js";
import { runCompletionHook } from "./completion-hooks.js";
import { stopShellTaskWatch } from "./shell-task-watch.js";
import { messageOf } from "../errors.js";
import { tmuxKillSession } from "../infra/tmux.js";
import { hasNewSessionChildProcess, hasSessionChildProcess, sessionChildProcessPids } from "./child-processes.js";
import {
  forgetMobileWebPushActivitySession,
  mobileWebPushKindForActivityTransition,
  type MobileWebPushActivityNotification,
  type MobileWebPushActivityState,
} from "../mobile-web-push/activity-notifier.js";

// The channel every session row is published on.
export const SESSIONS_CHANNEL = "sessions";

export interface SessionLifecycleDeps {
  /** Fan a row out to subscribers; a no-op before pub/sub exists. */
  publish: (channel: string, data: unknown) => void;
  /** Drop a session's AI title so the next turn regenerates it. */
  forgetTitle: (id: string) => void;
  /** The live turn's planning-vs-implementing phase, or null when nothing has been observed (#727). */
  workPhaseOf: (id: string) => WorkPhase | null;
  /** Drop that tracking when the session is torn down. */
  forgetWorkPhase: (id: string) => void;
  /** Free the tmux window/client size bookkeeping. Unlike a socket close — which a reattach
   *  undoes — a reap means this id will never be nudged again (#957). */
  forgetTerminalSize: (id: string) => void;
  notifyMobileWebPushActivity?: (notification: MobileWebPushActivityNotification) => void;
}

// Timers live per process, not per factory call — there is one server.
const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();
interface DeferredStop {
  timer: ReturnType<typeof setTimeout>;
  waiting: boolean;
  workingClear: boolean;
  event: string | undefined;
}

const deferredStops = new Map<string, DeferredStop>();
const childProcessBaselines = new Map<string, Set<number> | null>();
// Shell foreground tasks have no Claude/Codex hook stream. A long detached task finishing is
// represented to the UI as the existing Done row (`waiting=true`, `event="Stop"`), but unlike an
// agent's finished turn it must not age out until the terminal screen is actually opened.
const unacknowledgedShellDone = new Set<string>();
const CHILD_WORK_POLL_MS = 1000;

function refreshLastResponse(id: string, cwd: string): void {
  const text = readLatestResponse(id, cwd);
  if (text) lastResponses.set(id, text); // a failed read leaves any prior value
}

// On disconnect we don't kill an idle session immediately — a page reload is a
// brief disconnect, and reaping then would throw away a perfectly good live
// terminal (and its scrollback). Instead we keep the pty for a grace window; a
// reattach within it cancels the reap, so a reload just re-attaches to the same
// running terminal. Only after the window with no reattach do we reap.
const REAP_GRACE_MS = 30_000;
// A detached session that still needs the user — mid-turn output the user hasn't
// seen, or blocked on a permission/question prompt (the `waiting` flag) — is an
// unfinished task: reaping it loses work. So it gets a much longer grace than an
// idle one, long enough that you can switch away, do other things, and come back
// to answer it. Override with WAIT_REAP_GRACE_MS=0 to never auto-close these.
const WAIT_REAP_GRACE_DEFAULT_MS = 30 * 60_000;
const WAIT_REAP_GRACE_MS = parseWaitGraceMs(process.env.WAIT_REAP_GRACE_MS, WAIT_REAP_GRACE_DEFAULT_MS, (raw) =>
  console.warn(`[pty] ignoring non-numeric WAIT_REAP_GRACE_MS=${JSON.stringify(raw)}; using default ${WAIT_REAP_GRACE_DEFAULT_MS}ms`),
);

function cancelReap(id: string) {
  const t = reapTimers.get(id);
  if (t) {
    clearTimeout(t);
    reapTimers.delete(id);
  }
}

function cancelDeferredStop(id: string): void {
  const pending = deferredStops.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  deferredStops.delete(id);
}

function scheduleReap(deps: SessionLifecycleDeps, mobileWebPushActivityState: MobileWebPushActivityState, id: string, delayMs: number = REAP_GRACE_MS) {
  // null => never auto-reap; the session stays until reattached or explicitly
  // terminated (see reapTimerDelay for why a bad value must not reach setTimeout).
  const delay = reapTimerDelay(delayMs);
  if (delay === null) return;
  if (reapTimers.has(id)) return;
  reapTimers.set(
    id,
    setTimeout(() => {
      reapTimers.delete(id);
      const entry = ptys.get(id);
      if (entry && !entry.ws) reap(deps, mobileWebPushActivityState, id); // still detached after the grace window
    }, delay),
  );
}

function scheduleDetachedShellTaskCheck(deps: SessionLifecycleDeps, mobileWebPushActivityState: MobileWebPushActivityState, id: string): void {
  if (reapTimers.has(id)) return;
  reapTimers.set(
    id,
    setTimeout(() => {
      reapTimers.delete(id);
      armReapForDetached(deps, mobileWebPushActivityState, id);
    }, REAP_GRACE_MS),
  );
}

// Decide whether/when to reap a detached session based on its activity. A session
// that's actively thinking (`working`) is never reaped — that's "clearly working,
// don't close it". One that needs the user (`waiting`) gets the long grace. A
// genuinely idle session (finished AND already viewed, so neither flag) gets the
// short grace — that's the "auto-close inactive ones" behaviour. The ordering rule
// lives in reapDecisionFor (pure/tested).
function armReapForDetached(deps: SessionLifecycleDeps, mobileWebPushActivityState: MobileWebPushActivityState, id: string) {
  const entry = ptys.get(id);
  if (!entry || entry.ws) return; // still attached: nothing to reap
  // Recompute from scratch: state may have escalated (idle -> waiting) since the
  // last arm, and a stale short timer must not survive to reap a session that now
  // needs the user. cancelReap clears it so scheduleReap re-arms with the right grace.
  cancelReap(id);
  if (entry.agent === "shell" && hasSessionChildProcess(id, entry)) {
    console.log(`[pty] keeping shell session ${id} alive while foreground task runs (detached)`);
    scheduleDetachedShellTaskCheck(deps, mobileWebPushActivityState, id);
    return;
  }
  if (unacknowledgedShellDone.has(id)) {
    console.log(`[pty] keeping shell session ${id} alive with unacknowledged finished output`);
    return;
  }
  const decision = reapDecisionFor(activity.get(id), { idleMs: REAP_GRACE_MS, waitingMs: WAIT_REAP_GRACE_MS });
  if (decision.kind === "keep") {
    console.log(`[pty] keeping working session ${id} alive (detached)`);
    return;
  }
  scheduleReap(deps, mobileWebPushActivityState, id, decision.delayMs);
}

function reap(deps: SessionLifecycleDeps, mobileWebPushActivityState: MobileWebPushActivityState, id: string) {
  cancelReap(id);
  cancelDeferredStop(id);
  stopShellTaskWatch(id);
  childProcessBaselines.delete(id);
  unacknowledgedShellDone.delete(id);
  const entry = ptys.get(id);
  if (!entry) return; // already reaped
  ptys.delete(id);
  // An unpersisted new session vanishes with its pty; a persisted one stays
  // visible via its on-disk record.
  knownSessions.delete(id);
  launchChoices.delete(id); // the picked backend dies with the session that used it
  lastPrompts.delete(id); // don't leak prompt text for torn-down sessions
  lastResponses.delete(id); // ditto, and keep this map from growing across closed sessions
  // The transcript stops being frozen here: the next claude on this id (`--resume`, or a restart
  // after `/exit` — which reaches reap through term.onExit) appends to that file again.
  forgetClearedTranscript(id);
  deps.forgetTitle(id);
  deps.forgetWorkPhase(id); // the live turn dies with the session
  deps.forgetTerminalSize(id);
  titleInFlight.delete(id);
  lastTitledUserTurns.delete(id); // teardown only — kept across /clear as the re-title baseline
  lastTitleAttemptMs.delete(id);
  if (shouldForgetActivity(activity.get(id))) {
    activity.delete(id);
    hiddenSessions.delete(id); // the hidden flag rides with the record — see shouldForgetActivity
  }
  try {
    entry.term.kill();
  } catch {
    // already gone
  }
  // Killing the pty only DETACHES a tmux client — end the tmux session too so an
  // explicit close / idle reap actually stops the program (no orphan within a live
  // server). A server crash never runs this, so sessions survive that (the point).
  if (entry.tmux) tmuxKillSession(id);
  // A provider session's settings file holds its token — drop it with the session (#579).
  cleanupSessionSettings(id);
  // Files dropped into this session were copied to tmp for it alone; nothing else refers to them.
  cleanupSessionDrops(id);
  // The session is gone, so this is its last chance to report an outcome (#1070). Failure is
  // the right answer HERE because the hook is one-shot and a finished turn already claimed it
  // on the way past: reaching teardown with the hook still unfired means no Stop ever came —
  // a worker blocked on a dialog nobody can answer, or one that died before its first turn.
  //
  // BEFORE the announcement below, so that announcement can carry the outcome. The recorder this
  // fires is synchronous (it sets a flag), so the mark is in place by the time it is read — a
  // contract pinned in test/server/routes/worker-failure-wiring.spec.ts rather than left implied.
  void runCompletionHook(id, { didError: true }).catch((err) => console.error(`[completion-hook] ${messageOf(err)}`));
  // ONE message, not two. `event` stays "closed" because that is what every consumer of this
  // channel keys on to drop a reaped session (sessionActivity.ts); the outcome rides along as a
  // field. Publishing a second "worker-failed" message instead let the generic teardown
  // notification race ahead of the specific one, and beeped twice for one event (Codex, #1188).
  deps.publish(SESSIONS_CHANNEL, { id, working: false, event: "closed", failed: isFailedWorker(id) });
  forgetMobileWebPushActivitySession(mobileWebPushActivityState, id);
}

function cleanupManagedLiveSessions(deps: SessionLifecycleDeps, mobileWebPushActivityState: MobileWebPushActivityState): string[] {
  const ids = [...ptys.keys()];
  for (const id of ids) {
    try {
      reap(deps, mobileWebPushActivityState, id);
    } catch (err) {
      console.error(`[shutdown] failed to cleanup session ${id}: ${messageOf(err)}`);
    }
  }
  return ids;
}

function shouldDeferStop(id: string, event: string | undefined): boolean {
  return event === "Stop" && hasNewSessionChildProcess(id, ptys.get(id), childProcessBaselines.get(id) ?? null);
}

function deferFlagIfNeeded(
  deps: SessionLifecycleDeps,
  mobileWebPushActivityState: MobileWebPushActivityState,
  id: string,
  flag: ActivityFlag,
  value: boolean,
  event: string | undefined,
): boolean {
  if (flag === "waiting" && value && shouldDeferStop(id, event)) {
    deferStopFlag(deps, mobileWebPushActivityState, id, event, "waiting");
    return true;
  }
  if (flag === "working" && !value && shouldDeferStop(id, event)) {
    deferStopFlag(deps, mobileWebPushActivityState, id, event, "workingClear");
    return true;
  }
  return false;
}

function deferStopFlag(
  deps: SessionLifecycleDeps,
  mobileWebPushActivityState: MobileWebPushActivityState,
  id: string,
  event: string | undefined,
  flag: "waiting" | "workingClear",
): void {
  const existing = deferredStops.get(id);
  if (existing) {
    existing[flag] = true;
    return;
  }
  const poll = () => {
    if (shouldDeferStop(id, event)) {
      const pending = deferredStops.get(id);
      if (pending) pending.timer = setTimeout(poll, CHILD_WORK_POLL_MS);
      return;
    }
    const pending = deferredStops.get(id);
    if (!pending) return;
    deferredStops.delete(id);
    if (pending.waiting) setFlag(deps, mobileWebPushActivityState, id, "waiting", true, event);
    if (pending.workingClear) setFlag(deps, mobileWebPushActivityState, id, "working", false, event);
  };
  deferredStops.set(id, { timer: setTimeout(poll, CHILD_WORK_POLL_MS), waiting: flag === "waiting", workingClear: flag === "workingClear", event });
}

// Publish a session's current activity (working + waiting) to subscribers.
function publishActivity(deps: SessionLifecycleDeps, id: string) {
  const a = activity.get(id);
  // `cwd` rides along so the attention-sound player can pick up that directory's custom
  // sound (<cwd>/.mulmoterminal.json). Null for a session with no live PTY.
  const cwd = ptys.get(id)?.cwd ?? null;
  if (shouldRefreshReply(a, cwd, clearedTranscripts.has(id))) refreshLastResponse(id, cwd);
  const row = sessionRow(id, a, cwd, {
    lastPrompt: lastPrompts.get(id),
    aiTitle: aiTitles.get(id),
    lastResponse: lastResponses.get(id),
    memo: sessionMemos.get(id),
  });
  deps.publish(SESSIONS_CHANNEL, row);
}

function noteWorkingStart(id: string, flag: ActivityFlag, value: boolean, event: string | undefined): void {
  if (flag !== "working" || !value) return;
  cancelDeferredStop(id);
  if (event === "UserPromptSubmit") childProcessBaselines.set(id, sessionChildProcessPids(id, ptys.get(id)));
}

function noteShellDoneFlag(id: string, flag: ActivityFlag, value: boolean, event: string | undefined): void {
  if (flag !== "waiting" || ptys.get(id)?.agent !== "shell") return;
  if (!value) unacknowledgedShellDone.delete(id);
  else if (event === "Stop") unacknowledgedShellDone.add(id);
}

function notifyMobileWebPushTransition(
  deps: SessionLifecycleDeps,
  mobileWebPushActivityState: MobileWebPushActivityState,
  id: string,
  prev: Parameters<typeof mobileWebPushKindForActivityTransition>[2],
  next: Parameters<typeof mobileWebPushKindForActivityTransition>[3],
  event: string | undefined,
): void {
  const kind = mobileWebPushKindForActivityTransition(mobileWebPushActivityState, id, prev, next, event);
  if (!kind) return;
  try {
    deps.notifyMobileWebPushActivity?.({ kind, sessionId: id, agent: ptys.get(id)?.agent ?? null });
  } catch (err) {
    console.warn(`[mobile-web-push] activity notification dropped for ${id}: ${messageOf(err)}`);
  }
}

// Set a session's working (thinking, UserPromptSubmit→Stop) or waiting (needs the user)
// flag, publish the change, persist it, and re-arm the reap on the edge that calls for it.
// A no-op when the flag's value did not actually move — flagEffect returns null and every
// hook calls through here, so an unchanged publish would flood the socket.
function setFlag(
  deps: SessionLifecycleDeps,
  mobileWebPushActivityState: MobileWebPushActivityState,
  id: string,
  flag: ActivityFlag,
  value: boolean,
  event?: string,
) {
  noteWorkingStart(id, flag, value, event);
  if (deferFlagIfNeeded(deps, mobileWebPushActivityState, id, flag, value, event)) return;
  const prev = activity.get(id);
  noteShellDoneFlag(id, flag, value, event);
  const effect = flagEffect(prev, flag, value, event, Date.now());
  if (!effect.next) return;
  activity.set(id, effect.next);
  if (flag === "working" && !value) childProcessBaselines.delete(id);
  claimActivityOwnership(id); // this instance drives this session — persist may write/remove it
  publishActivity(deps, id);
  // Persist so an in-progress turn / the blocked-or-done set survives a restart (ACTIVITY_STATE_FILE).
  persistActivityState((id) => hiddenSessions.has(id));
  notifyMobileWebPushTransition(deps, mobileWebPushActivityState, id, prev, effect.next, event);
  if (effect.rearmReap) armReapForDetached(deps, mobileWebPushActivityState, id);
}

function acknowledgeShellDone(deps: SessionLifecycleDeps, mobileWebPushActivityState: MobileWebPushActivityState, id: string): void {
  if (!unacknowledgedShellDone.has(id)) return;
  unacknowledgedShellDone.delete(id);
  setFlag(deps, mobileWebPushActivityState, id, "waiting", false);
  armReapForDetached(deps, mobileWebPushActivityState, id);
}

export function createSessionLifecycle(deps: SessionLifecycleDeps) {
  const mobileWebPushActivityState: MobileWebPushActivityState = new Map();
  return {
    refreshLastResponse,
    cancelReap,
    scheduleReap: (id: string, delayMs?: number) => scheduleReap(deps, mobileWebPushActivityState, id, delayMs),
    armReapForDetached: (id: string) => armReapForDetached(deps, mobileWebPushActivityState, id),
    reap: (id: string) => reap(deps, mobileWebPushActivityState, id),
    cleanupManagedLiveSessions: () => cleanupManagedLiveSessions(deps, mobileWebPushActivityState),
    publishActivity: (id: string) => publishActivity(deps, id),
    acknowledgeShellDone: (id: string) => acknowledgeShellDone(deps, mobileWebPushActivityState, id),
    setWorking: (id: string, working: boolean, event?: string) => setFlag(deps, mobileWebPushActivityState, id, "working", working, event),
    setWaiting: (id: string, waiting: boolean, event?: string) => setFlag(deps, mobileWebPushActivityState, id, "waiting", waiting, event),
  };
}
