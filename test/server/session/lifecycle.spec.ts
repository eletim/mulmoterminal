// @vitest-environment node
//
// The stateful half of session teardown: it holds timers and calls things in an order that
// matters. The DECISIONS it consults (reapDecisionFor, shouldForgetActivity, nextActivity)
// have their own specs; what is exercised here is the orchestration that used to be
// unreachable without booting the server.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSessionLifecycle as createViewerLifecycle, type SessionLifecycleDeps } from "../../../server/session/lifecycle.js";
import { createSessionActivity, type ActivityServiceDeps } from "../../../server/session/session-activity.js";
import { activity, antigravityConversations, codexRolloutIds, lastPrompts, lastResponses, ptys, sessionMemos } from "../../../server/session/registry.js";
import { clearedTranscripts } from "../../../server/session/cleared-transcripts.js";
import { hasNewSessionChildProcess, hasSessionChildProcess, sessionChildProcessPids } from "../../../server/session/child-processes.js";
import { stopShellTaskWatch } from "../../../server/session/shell-task-watch.js";
vi.mock("../../../server/session/session-settings.js", () => ({ cleanupSessionSettings: vi.fn() }));
vi.mock("../../../server/session/session-drops.js", () => ({ cleanupSessionDrops: vi.fn() }));
vi.mock("../../../server/session/shell-task-watch.js", () => ({ stopShellTaskWatch: vi.fn() }));
vi.mock("../../../server/session/child-processes.js", () => ({
  hasNewSessionChildProcess: vi.fn(() => false),
  hasSessionChildProcess: vi.fn(() => false),
  sessionChildProcessPids: vi.fn(() => new Set<number>()),
}));
// The reply the roster shows is re-read from the transcript at the end of a turn; the tests
// stand in for that file so the refresh can be observed without writing one.
vi.mock("../../../server/session/session-reads.js", () => ({ readLatestResponse: vi.fn(() => "the reply on disk") }));

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "22222222-3333-4444-8555-666666666666";
const THIRD_ID = "33333333-4444-4555-8666-777777777777";

type TestDeps = SessionLifecycleDeps & ActivityServiceDeps;
const makeDeps = (overrides: Partial<TestDeps> = {}): TestDeps => ({
  publish: vi.fn(),
  forgetWorkPhase: vi.fn(),
  forgetTerminalSize: vi.fn(),
  coreMetadataOf: vi.fn(() => ({ cwd: "/work", agent: "claude" as const })),
  ...overrides,
});
const coreAgent = (agent: "claude" | "codex" | "shell") => vi.fn(() => ({ cwd: "/work", agent }));

// The implementations are intentionally separate; this combined test facade lets the historical
// behavior assertions exercise each owner while lifecycle.ts itself exposes no activity API.
const createSessionLifecycle = (deps: TestDeps) => ({ ...createViewerLifecycle(deps), ...createSessionActivity(deps) });

// A pty entry with just the fields the lifecycle reads.
const fakeEntry = (over: Record<string, unknown> = {}) => ({ term: { kill: vi.fn() }, ws: null, cwd: "/work", tmux: false, agent: "claude", ...over }) as never;

const clearRegistry = () => {
  const lifecycle = createSessionLifecycle(makeDeps());
  lifecycle.reap(ID);
  lifecycle.reap(OTHER_ID);
  lifecycle.reap(THIRD_ID);
  for (const map of [ptys, activity, lastPrompts, lastResponses, codexRolloutIds, antigravityConversations, sessionMemos]) {
    map.clear();
  }
  clearedTranscripts.clear();
};

beforeEach(() => {
  clearRegistry();
  vi.mocked(hasNewSessionChildProcess).mockReset().mockReturnValue(false);
  vi.mocked(hasSessionChildProcess).mockReset().mockReturnValue(false);
  vi.mocked(sessionChildProcessPids).mockReset().mockReturnValue(new Set());
  vi.mocked(stopShellTaskWatch).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  clearRegistry();
});

describe("reap", () => {
  it("releases only viewer-owned transport state", () => {
    const deps = makeDeps();
    ptys.set(ID, fakeEntry());
    lastPrompts.set(ID, "p");
    lastResponses.set(ID, "r");

    createSessionLifecycle(deps).reap(ID);

    expect([ptys.has(ID), lastPrompts.has(ID), lastResponses.has(ID)]).toEqual([false, true, true]);
    expect(stopShellTaskWatch).not.toHaveBeenCalled();
    // A socket close only pauses the tmux size bookkeeping (a detached session can reattach);
    // teardown is the one place that frees it, or it grows for the server's whole life (#957).
    expect(deps.forgetTerminalSize).toHaveBeenCalledWith(ID);
  });

  it("kills the viewer pty without publishing an activity lifecycle event", () => {
    const deps = makeDeps();
    const entry = fakeEntry();
    ptys.set(ID, entry);
    createSessionLifecycle(deps).reap(ID);
    expect((entry as { term: { kill: ReturnType<typeof vi.fn> } }).term.kill).toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("does not change transcript state during viewer release", () => {
    ptys.set(ID, fakeEntry());
    clearedTranscripts.add(ID);
    createSessionLifecycle(makeDeps()).reap(ID);
    expect(clearedTranscripts.has(ID)).toBe(true);
  });

  it("does nothing for a session that was already reaped", () => {
    const deps = makeDeps();
    createSessionLifecycle(deps).reap(ID);
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("never changes activity records during viewer teardown", () => {
    const deps = makeDeps();
    const lifecycle = createSessionLifecycle(deps);

    ptys.set(ID, fakeEntry());
    activity.set(ID, { working: false, waiting: true, event: "Notification", at: 1 });
    lifecycle.reap(ID);
    expect(activity.has(ID)).toBe(true);

    activity.set(ID, { working: false, waiting: false, event: "Stop", at: 1 });
    ptys.set(ID, fakeEntry());
    lifecycle.reap(ID);
    expect(activity.has(ID)).toBe(true);
  });
});

describe("process/delete resource cleanup", () => {
  it("clears process-owned display and transcript resources independently of a viewer", () => {
    lastPrompts.set(ID, "p");
    lastResponses.set(ID, "r");
    clearedTranscripts.add(ID);

    createViewerLifecycle(makeDeps()).cleanupSessionResources(ID);

    expect([lastPrompts.has(ID), lastResponses.has(ID), clearedTranscripts.has(ID)]).toEqual([false, false, false]);
    expect(stopShellTaskWatch).toHaveBeenCalledWith(ID);
  });
});

describe("cleanupManagedLiveSessions", () => {
  it("cleans up every managed live session", () => {
    const deps = makeDeps();
    const claude = fakeEntry({ agent: "claude", tmux: true });
    const codex = fakeEntry({ agent: "codex", tmux: true });
    const shell = fakeEntry({ agent: "shell", tmux: false });
    ptys.set(ID, claude);
    ptys.set(OTHER_ID, codex);
    ptys.set(THIRD_ID, shell);

    const cleaned = createSessionLifecycle(deps).cleanupManagedLiveSessions();

    expect(cleaned).toEqual([ID, OTHER_ID, THIRD_ID]);
    expect(ptys.size).toBe(0);
    expect((claude as { term: { kill: ReturnType<typeof vi.fn> } }).term.kill).toHaveBeenCalled();
    expect((codex as { term: { kill: ReturnType<typeof vi.fn> } }).term.kill).toHaveBeenCalled();
    expect((shell as { term: { kill: ReturnType<typeof vi.fn> } }).term.kill).toHaveBeenCalled();
  });

  it("continues cleanup across all transient clients", () => {
    const first = fakeEntry({ tmux: true });
    const second = fakeEntry({ tmux: true });
    ptys.set(ID, first);
    ptys.set(OTHER_ID, second);
    createSessionLifecycle(makeDeps()).cleanupManagedLiveSessions();

    expect(ptys.size).toBe(0);
    expect((first as { term: { kill: ReturnType<typeof vi.fn> } }).term.kill).toHaveBeenCalled();
    expect((second as { term: { kill: ReturnType<typeof vi.fn> } }).term.kill).toHaveBeenCalled();
  });

  it("does not kill Core sessions when transient clients are cleaned up", () => {
    ptys.set(ID, fakeEntry({ tmux: true }));

    createSessionLifecycle(makeDeps()).cleanupManagedLiveSessions();

    expect(ptys.size).toBe(0);
  });

  it("does not delete persistent conversation history state", () => {
    ptys.set(ID, fakeEntry({ tmux: true }));
    sessionMemos.set(ID, "keep this note");
    codexRolloutIds.set(ID, "rollout-1");
    antigravityConversations.set(ID, { sessionId: ID, conversationId: OTHER_ID, cwd: "/work", startedAt: 123 });

    createSessionLifecycle(makeDeps()).cleanupManagedLiveSessions();

    expect(sessionMemos.get(ID)).toBe("keep this note");
    expect(codexRolloutIds.get(ID)).toBe("rollout-1");
    expect(antigravityConversations.get(ID)).toEqual({ sessionId: ID, conversationId: OTHER_ID, cwd: "/work", startedAt: 123 });
  });

  it("is safe to call more than once", () => {
    const entry = fakeEntry({ tmux: true });
    ptys.set(ID, entry);
    const lifecycle = createSessionLifecycle(makeDeps());

    expect(lifecycle.cleanupManagedLiveSessions()).toEqual([ID]);
    expect(lifecycle.cleanupManagedLiveSessions()).toEqual([]);

    expect((entry as { term: { kill: ReturnType<typeof vi.fn> } }).term.kill).toHaveBeenCalledTimes(1);
  });
});

describe("setWorking / setWaiting", () => {
  it("publishes a row when the flag actually changes", () => {
    const deps = makeDeps();
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionLifecycle(deps).setWorking(ID, true, "UserPromptSubmit");
    expect(activity.get(ID)?.working).toBe(true);
    expect(deps.publish).toHaveBeenCalled();
  });

  // Every hook fires these; publishing an unchanged row would flood the socket.
  it("stays silent when the flag is unchanged", () => {
    const deps = makeDeps();
    const lifecycle = createSessionLifecycle(deps);
    ptys.set(ID, fakeEntry({ ws: {} }));
    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    (deps.publish as ReturnType<typeof vi.fn>).mockClear();
    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    expect(deps.publish).not.toHaveBeenCalled();
  });

  // Subscribers render the same status vocabulary as the cockpit roster, which needs the event
  // (blocked vs done) alongside the flags.
  it("mirrors the flags and event to subscribers", () => {
    const deps = makeDeps();
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionLifecycle(deps).setWaiting(ID, true, "Notification");
    expect(deps.publish).toHaveBeenCalledWith("sessions", expect.objectContaining({ id: ID, working: false, waiting: true, event: "Notification" }));
  });

  it("notifies local mobile Web Push when a running session starts waiting for input", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ coreMetadataOf: coreAgent("codex"), notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "codex" }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    notifyMobileWebPushActivity.mockClear();
    lifecycle.setWaiting(ID, true, "Notification");
    lifecycle.setWaiting(ID, true, "Notification");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "waiting", sessionId: ID, agent: "codex" });
  });

  it("notifies local mobile Web Push once when a running session completes", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "claude" }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    notifyMobileWebPushActivity.mockClear();
    lifecycle.setWaiting(ID, true, "Stop");
    lifecycle.setWorking(ID, false, "Stop");
    lifecycle.setWorking(ID, false, "Stop");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "finished", sessionId: ID, agent: "claude" });
  });

  it("does not notify local mobile Web Push when a PTY exits before Stop", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "claude" }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    notifyMobileWebPushActivity.mockClear();
    lifecycle.setWorking(ID, false);

    expect(notifyMobileWebPushActivity).not.toHaveBeenCalled();
  });

  it("notifies local mobile Web Push for the Stop row that makes the desktop sound beep without a working flag", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "claude" }));

    createSessionLifecycle(deps).setWaiting(ID, true, "Stop");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "finished", sessionId: ID, agent: "claude" });
  });

  it("does not notify local mobile Web Push on first observation of waiting", () => {
    const notifyMobileWebPushActivity = vi.fn();
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionLifecycle(makeDeps({ notifyMobileWebPushActivity })).setWaiting(ID, true, "Notification");
    expect(notifyMobileWebPushActivity).not.toHaveBeenCalled();
  });

  it("notifies independently for separate sessions", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({
      coreMetadataOf: vi.fn((id) => ({ cwd: "/work", agent: id === OTHER_ID ? ("codex" as const) : ("claude" as const) })),
      notifyMobileWebPushActivity,
    });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "claude" }));
    ptys.set(OTHER_ID, fakeEntry({ ws: {}, agent: "codex" }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    lifecycle.setWorking(OTHER_ID, true, "UserPromptSubmit");
    notifyMobileWebPushActivity.mockClear();
    lifecycle.setWaiting(ID, true, "Notification");
    lifecycle.setWaiting(OTHER_ID, true, "Notification");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(2);
    expect(notifyMobileWebPushActivity).toHaveBeenNthCalledWith(1, { kind: "waiting", sessionId: ID, agent: "claude" });
    expect(notifyMobileWebPushActivity).toHaveBeenNthCalledWith(2, { kind: "waiting", sessionId: OTHER_ID, agent: "codex" });
  });

  it("notifies again after a viewed session starts a later turn and blocks again", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ coreMetadataOf: coreAgent("codex"), notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "codex" }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    lifecycle.setWaiting(ID, true, "Notification");
    lifecycle.setWaiting(ID, false);
    lifecycle.setWorking(ID, false, "Stop");
    notifyMobileWebPushActivity.mockClear();

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    lifecycle.setWaiting(ID, true, "Notification");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "waiting", sessionId: ID, agent: "codex" });
  });

  it("notifies again after the previous input wait is answered in the same turn", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ coreMetadataOf: coreAgent("codex"), notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "codex" }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    lifecycle.setWaiting(ID, true, "Notification");
    lifecycle.setWaiting(ID, false);
    notifyMobileWebPushActivity.mockClear();

    lifecycle.setWaiting(ID, true, "Notification");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "waiting", sessionId: ID, agent: "codex" });
  });

  it("applies Stop immediately without polling reviewer child processes", () => {
    vi.useFakeTimers();
    const hasNewChildren = vi.mocked(hasNewSessionChildProcess);
    vi.mocked(sessionChildProcessPids).mockReturnValue(new Set([200]));
    hasNewChildren.mockReturnValue(true);
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, term: { pid: 100, kill: vi.fn() } }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    notifyMobileWebPushActivity.mockClear();
    lifecycle.setWaiting(ID, true, "Stop");
    lifecycle.setWorking(ID, false, "Stop");

    expect(activity.get(ID)).toMatchObject({ working: false, waiting: true, event: "Stop" });
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "finished", sessionId: ID, agent: "claude" });
    expect(hasNewChildren).not.toHaveBeenCalled();

    hasNewChildren.mockReturnValue(false);
    vi.advanceTimersByTime(1000);

    expect(activity.get(ID)).toMatchObject({ working: false, waiting: true, event: "Stop" });
  });

  it("cancels a deferred Stop clear when a later turn starts", () => {
    vi.useFakeTimers();
    const hasNewChildren = vi.mocked(hasNewSessionChildProcess);
    hasNewChildren.mockReturnValue(true);
    const deps = makeDeps();
    ptys.set(ID, fakeEntry({ ws: {}, term: { pid: 100, kill: vi.fn() } }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    lifecycle.setWaiting(ID, true, "Stop");
    lifecycle.setWorking(ID, false, "Stop");
    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    hasNewChildren.mockReturnValue(false);
    vi.advanceTimersByTime(1000);

    expect(activity.get(ID)).toMatchObject({ working: true });
    expect(activity.get(ID)?.waiting).toBe(true);
  });

  it("does not keep working for child processes that were already present at turn start", () => {
    vi.useFakeTimers();
    vi.mocked(sessionChildProcessPids).mockReturnValue(new Set([200]));
    vi.mocked(hasNewSessionChildProcess).mockReturnValue(false);
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, term: { pid: 100, kill: vi.fn() } }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    notifyMobileWebPushActivity.mockClear();
    lifecycle.setWaiting(ID, true, "Stop");
    lifecycle.setWorking(ID, false, "Stop");

    expect(activity.get(ID)).toMatchObject({ working: false, waiting: true, event: "Stop" });
    expect(deps.publish).toHaveBeenLastCalledWith("sessions", expect.objectContaining({ id: ID, working: false, waiting: true, event: "Stop" }));
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "finished", sessionId: ID, agent: "claude" });
    vi.advanceTimersByTime(1000);
    expect(vi.mocked(hasNewSessionChildProcess)).not.toHaveBeenCalled();
  });

  it("keeps activity updates working when a local mobile Web Push notification throws", () => {
    const deps = makeDeps({
      notifyMobileWebPushActivity: () => {
        throw new Error("push failed");
      },
    });
    ptys.set(ID, fakeEntry({ ws: {} }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    expect(() => lifecycle.setWaiting(ID, true, "Notification")).not.toThrow();
    expect(activity.get(ID)).toMatchObject({ working: true, waiting: true, event: "Notification" });
    expect(deps.publish).toHaveBeenCalled();
  });
});

// The end of a turn is when the roster's copy of the reply is refreshed from the transcript —
// and, after a /clear, the moment the pre-clear reply used to come back (#1085). The rule itself
// is shouldRefreshReply's; what is pinned here is that the lifecycle actually asks it about THIS
// session, since passing a constant would read as working right up to the clear.
describe("publishActivity's reply refresh", () => {
  const endATurn = () => {
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionLifecycle(makeDeps()).setWaiting(ID, true, "Stop");
  };

  it("re-reads the transcript when a turn ends", () => {
    endATurn();
    expect(lastResponses.get(ID)).toBe("the reply on disk");
  });

  it("leaves a cleared session's blank reply alone", () => {
    lastResponses.set(ID, ""); // what /clear writes
    clearedTranscripts.add(ID);
    endATurn();
    expect(lastResponses.get(ID)).toBe("");
  });
});

describe("the reap timer", () => {
  // A session the user is looking at must never be reaped out from under them.
  // Two independent guards protect an attached session: arming skips it, and the timer
  // re-checks when it fires. Asserting only "the session survived" cannot tell them apart —
  // removing either one alone still leaves it alive. So this asserts the arming guard
  // directly, by observing that no timer was created at all.
  it("does not arm anything while a client is attached", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    ptys.set(ID, fakeEntry({ ws: {} }));
    activity.set(ID, { working: false, waiting: false, event: "Stop", at: 1 });
    createSessionLifecycle(deps).armReapForDetached(ID);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60 * 60_000);
    expect(ptys.has(ID)).toBe(true);
  });

  it("uses the fixed viewer grace even while activity says working", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    ptys.set(ID, fakeEntry());
    activity.set(ID, { working: true, waiting: false, event: "UserPromptSubmit", at: 1 });
    createSessionLifecycle(deps).armReapForDetached(ID);
    vi.advanceTimersByTime(60 * 60_000);
    expect(ptys.has(ID)).toBe(false);
  });

  it("does not inspect shell child processes for viewer lifetime", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    vi.mocked(hasSessionChildProcess).mockReturnValue(true);
    ptys.set(ID, fakeEntry({ agent: "shell" }));

    createSessionLifecycle(deps).armReapForDetached(ID);
    vi.advanceTimersByTime(5 * 60_000);

    expect(ptys.has(ID)).toBe(false);
    expect(hasSessionChildProcess).not.toHaveBeenCalled();
  });

  it("reaps a detached shell after one fixed grace", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    vi.mocked(hasSessionChildProcess).mockReturnValueOnce(true).mockReturnValueOnce(false);
    ptys.set(ID, fakeEntry({ agent: "shell" }));

    createSessionLifecycle(deps).armReapForDetached(ID);
    vi.advanceTimersByTime(30_000);
    expect(ptys.has(ID)).toBe(false);
  });

  it("does not use unacknowledged shell activity as viewer retention", () => {
    vi.useFakeTimers();
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ coreMetadataOf: coreAgent("shell"), notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ agent: "shell" }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    lifecycle.setWaiting(ID, true, "Stop");
    lifecycle.setWorking(ID, false, "Stop");
    lifecycle.armReapForDetached(ID);
    vi.advanceTimersByTime(31 * 60_000);

    expect(ptys.has(ID)).toBe(false);
    expect(activity.get(ID)).toMatchObject({ working: false, waiting: true, event: "Stop" });
    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "finished", sessionId: ID, agent: "shell" });

    lifecycle.acknowledgeShellDone(ID);
    expect(activity.get(ID)).toMatchObject({ working: false, waiting: false, event: "Stop" });
    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(ptys.has(ID)).toBe(false);
  });

  it("lets the existing desktop view clear acknowledge shell Done before detached idle reap", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    const entry = fakeEntry({ agent: "shell" });
    ptys.set(ID, entry);
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    lifecycle.setWaiting(ID, true, "Stop");
    lifecycle.setWorking(ID, false, "Stop");
    (entry as { ws: unknown }).ws = {};
    lifecycle.setWaiting(ID, false);
    (entry as { ws: unknown }).ws = null;
    lifecycle.armReapForDetached(ID);
    vi.advanceTimersByTime(30_001);

    expect(ptys.has(ID)).toBe(false);
  });

  it("does not let waiting activity arm or alter viewer cleanup", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    ptys.set(ID, fakeEntry({ agent: "codex" }));

    createSessionLifecycle(deps).setWaiting(ID, true, "Notification");
    vi.advanceTimersByTime(30 * 60_000 + 1);

    expect(ptys.has(ID)).toBe(true);
    createSessionLifecycle(deps).armReapForDetached(ID);
    vi.advanceTimersByTime(30_001);
    expect(ptys.has(ID)).toBe(false);
  });

  it("still reaps an unacknowledged finished shell immediately on explicit Stop", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    ptys.set(ID, fakeEntry({ agent: "shell" }));
    const lifecycle = createSessionLifecycle(deps);

    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    lifecycle.setWaiting(ID, true, "Stop");
    lifecycle.setWorking(ID, false, "Stop");
    lifecycle.reap(ID);

    expect(ptys.has(ID)).toBe(false);
  });

  it("reaps a detached idle session after the short grace", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    ptys.set(ID, fakeEntry());
    createSessionLifecycle(deps).armReapForDetached(ID);
    vi.advanceTimersByTime(29_000);
    expect(ptys.has(ID)).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(ptys.has(ID)).toBe(false);
  });

  // A reattach within the window is the whole point: a page reload must not cost the session.
  it("cancels a pending reap", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    const lifecycle = createSessionLifecycle(deps);
    ptys.set(ID, fakeEntry());
    lifecycle.armReapForDetached(ID);
    lifecycle.cancelReap(ID);
    vi.advanceTimersByTime(60 * 60_000);
    expect(ptys.has(ID)).toBe(true);
  });

  // The timer fires on a session that has since reattached — it must check again, not reap.
  it("does not reap a session that reattached during the grace", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    ptys.set(ID, fakeEntry());
    createSessionLifecycle(deps).armReapForDetached(ID);
    ptys.set(ID, fakeEntry({ ws: {} })); // the user came back
    vi.advanceTimersByTime(60_000);
    expect(ptys.has(ID)).toBe(true);
  });
});
