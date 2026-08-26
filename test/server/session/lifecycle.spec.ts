// @vitest-environment node
//
// Transitional process-owned cleanup plus the independent activity service. Viewer transport
// behavior has its own attach/detach/release tests in pty-connection.spec.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSessionLifecycle as createProcessResourceCleanup } from "../../../server/session/lifecycle.js";
import { createSessionActivity, type ActivityServiceDeps } from "../../../server/session/session-activity.js";
import { activity, lastPrompts, lastResponses, ptys } from "../../../server/session/registry.js";
import { clearedTranscripts } from "../../../server/session/cleared-transcripts.js";
import { hasNewSessionChildProcess, sessionChildProcessPids } from "../../../server/session/child-processes.js";
import { stopShellTaskWatch } from "../../../server/session/shell-task-watch.js";
vi.mock("../../../server/session/session-settings.js", () => ({ cleanupSessionSettings: vi.fn() }));
vi.mock("../../../server/session/session-drops.js", () => ({ cleanupSessionDrops: vi.fn() }));
vi.mock("../../../server/session/shell-task-watch.js", () => ({ stopShellTaskWatch: vi.fn() }));
vi.mock("../../../server/session/child-processes.js", () => ({
  hasNewSessionChildProcess: vi.fn(() => false),
  sessionChildProcessPids: vi.fn(() => new Set<number>()),
}));
// The reply the roster shows is re-read from the transcript at the end of a turn; the tests
// stand in for that file so the refresh can be observed without writing one.
vi.mock("../../../server/session/session-reads.js", () => ({ readLatestResponse: vi.fn(() => "the reply on disk") }));

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "22222222-3333-4444-8555-666666666666";

type TestDeps = ActivityServiceDeps;
const makeDeps = (overrides: Partial<TestDeps> = {}): TestDeps => ({
  publish: vi.fn(),
  forgetWorkPhase: vi.fn(),
  coreMetadataOf: vi.fn(() => ({ cwd: "/work", agent: "claude" as const })),
  ...overrides,
});
const coreAgent = (agent: "claude" | "codex" | "shell") => vi.fn(() => ({ cwd: "/work", agent }));

// The implementations are intentionally separate; this combined test facade lets the historical
// behavior assertions exercise each owner while lifecycle.ts itself exposes no activity API.
const createSessionLifecycle = (deps: TestDeps) => ({ ...createProcessResourceCleanup(), ...createSessionActivity(deps) });

// A pty entry with just the fields the lifecycle reads.
const fakeEntry = (over: Record<string, unknown> = {}) => ({ term: { kill: vi.fn() }, ws: null, cwd: "/work", tmux: false, agent: "claude", ...over }) as never;

const clearRegistry = () => {
  for (const map of [ptys, activity, lastPrompts, lastResponses]) {
    map.clear();
  }
  clearedTranscripts.clear();
};

beforeEach(() => {
  clearRegistry();
  vi.mocked(hasNewSessionChildProcess).mockReset().mockReturnValue(false);
  vi.mocked(sessionChildProcessPids).mockReset().mockReturnValue(new Set());
  vi.mocked(stopShellTaskWatch).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  clearRegistry();
});

describe("process/delete resource cleanup", () => {
  it("clears process-owned display and transcript resources independently of a viewer", () => {
    lastPrompts.set(ID, "p");
    lastResponses.set(ID, "r");
    clearedTranscripts.add(ID);

    createProcessResourceCleanup().cleanupSessionResources(ID);

    expect([lastPrompts.has(ID), lastResponses.has(ID), clearedTranscripts.has(ID)]).toEqual([false, false, false]);
    expect(stopShellTaskWatch).toHaveBeenCalledWith(ID);
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
