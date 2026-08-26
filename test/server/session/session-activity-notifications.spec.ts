// @vitest-environment node
//
// Independent activity service. Viewer transport and process-owned cleanup have owner-specific
// tests in pty-connection.spec.ts and the corresponding agent/resource modules.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSessionActivity, type ActivityServiceDeps } from "../../../server/session/session-activity.js";
import { activity, lastPrompts, lastResponses, ptys } from "../../../server/session/registry.js";
import { clearedTranscripts } from "../../../server/session/cleared-transcripts.js";
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

// A pty entry with just the fields the activity service reads.
const fakeEntry = (over: Record<string, unknown> = {}) => ({ term: { kill: vi.fn() }, ws: null, cwd: "/work", tmux: false, agent: "claude", ...over }) as never;

const clearRegistry = () => {
  for (const map of [ptys, activity, lastPrompts, lastResponses]) {
    map.clear();
  }
  clearedTranscripts.clear();
};

beforeEach(() => {
  clearRegistry();
});
afterEach(() => {
  clearRegistry();
});

describe("setWorking / setWaiting", () => {
  it("publishes a row when the flag actually changes", () => {
    const deps = makeDeps();
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionActivity(deps).setWorking(ID, true, "UserPromptSubmit");
    expect(activity.get(ID)?.working).toBe(true);
    expect(deps.publish).toHaveBeenCalled();
  });

  // Every hook fires these; publishing an unchanged row would flood the socket.
  it("stays silent when the flag is unchanged", () => {
    const deps = makeDeps();
    const service = createSessionActivity(deps);
    ptys.set(ID, fakeEntry({ ws: {} }));
    service.setWorking(ID, true, "UserPromptSubmit");
    (deps.publish as ReturnType<typeof vi.fn>).mockClear();
    service.setWorking(ID, true, "UserPromptSubmit");
    expect(deps.publish).not.toHaveBeenCalled();
  });

  // Subscribers render the same status vocabulary as the cockpit roster, which needs the event
  // (blocked vs done) alongside the flags.
  it("mirrors the flags and event to subscribers", () => {
    const deps = makeDeps();
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionActivity(deps).setWaiting(ID, true, "Notification");
    expect(deps.publish).toHaveBeenCalledWith("sessions", expect.objectContaining({ id: ID, working: false, waiting: true, event: "Notification" }));
  });

  it("notifies local mobile Web Push when a running session starts waiting for input", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ coreMetadataOf: coreAgent("codex"), notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "codex" }));
    const service = createSessionActivity(deps);

    service.setWorking(ID, true, "UserPromptSubmit");
    notifyMobileWebPushActivity.mockClear();
    service.setWaiting(ID, true, "Notification");
    service.setWaiting(ID, true, "Notification");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "waiting", sessionId: ID, agent: "codex" });
  });

  it("notifies local mobile Web Push once when a running session completes", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "claude" }));
    const service = createSessionActivity(deps);

    service.setWorking(ID, true, "UserPromptSubmit");
    notifyMobileWebPushActivity.mockClear();
    service.setWaiting(ID, true, "Stop");
    service.setWorking(ID, false, "Stop");
    service.setWorking(ID, false, "Stop");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "finished", sessionId: ID, agent: "claude" });
  });

  it("does not notify local mobile Web Push when a PTY exits before Stop", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "claude" }));
    const service = createSessionActivity(deps);

    service.setWorking(ID, true, "UserPromptSubmit");
    notifyMobileWebPushActivity.mockClear();
    service.setWorking(ID, false);

    expect(notifyMobileWebPushActivity).not.toHaveBeenCalled();
  });

  it("notifies local mobile Web Push for the Stop row that makes the desktop sound beep without a working flag", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "claude" }));

    createSessionActivity(deps).setWaiting(ID, true, "Stop");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "finished", sessionId: ID, agent: "claude" });
  });

  it("does not notify local mobile Web Push on first observation of waiting", () => {
    const notifyMobileWebPushActivity = vi.fn();
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionActivity(makeDeps({ notifyMobileWebPushActivity })).setWaiting(ID, true, "Notification");
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
    const service = createSessionActivity(deps);

    service.setWorking(ID, true, "UserPromptSubmit");
    service.setWorking(OTHER_ID, true, "UserPromptSubmit");
    notifyMobileWebPushActivity.mockClear();
    service.setWaiting(ID, true, "Notification");
    service.setWaiting(OTHER_ID, true, "Notification");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(2);
    expect(notifyMobileWebPushActivity).toHaveBeenNthCalledWith(1, { kind: "waiting", sessionId: ID, agent: "claude" });
    expect(notifyMobileWebPushActivity).toHaveBeenNthCalledWith(2, { kind: "waiting", sessionId: OTHER_ID, agent: "codex" });
  });

  it("notifies again after a viewed session starts a later turn and blocks again", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ coreMetadataOf: coreAgent("codex"), notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "codex" }));
    const service = createSessionActivity(deps);

    service.setWorking(ID, true, "UserPromptSubmit");
    service.setWaiting(ID, true, "Notification");
    service.setWaiting(ID, false);
    service.setWorking(ID, false, "Stop");
    notifyMobileWebPushActivity.mockClear();

    service.setWorking(ID, true, "UserPromptSubmit");
    service.setWaiting(ID, true, "Notification");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "waiting", sessionId: ID, agent: "codex" });
  });

  it("notifies again after the previous input wait is answered in the same turn", () => {
    const notifyMobileWebPushActivity = vi.fn();
    const deps = makeDeps({ coreMetadataOf: coreAgent("codex"), notifyMobileWebPushActivity });
    ptys.set(ID, fakeEntry({ ws: {}, agent: "codex" }));
    const service = createSessionActivity(deps);

    service.setWorking(ID, true, "UserPromptSubmit");
    service.setWaiting(ID, true, "Notification");
    service.setWaiting(ID, false);
    notifyMobileWebPushActivity.mockClear();

    service.setWaiting(ID, true, "Notification");

    expect(notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "waiting", sessionId: ID, agent: "codex" });
  });

  it("keeps activity updates working when a local mobile Web Push notification throws", () => {
    const deps = makeDeps({
      notifyMobileWebPushActivity: () => {
        throw new Error("push failed");
      },
    });
    ptys.set(ID, fakeEntry({ ws: {} }));
    const service = createSessionActivity(deps);

    service.setWorking(ID, true, "UserPromptSubmit");
    expect(() => service.setWaiting(ID, true, "Notification")).not.toThrow();
    expect(activity.get(ID)).toMatchObject({ working: true, waiting: true, event: "Notification" });
    expect(deps.publish).toHaveBeenCalled();
  });
});

// The end of a turn is when the roster's copy of the reply is refreshed from the transcript —
// and, after a /clear, the moment the pre-clear reply used to come back (#1085). The rule itself
// is shouldRefreshReply's; what is pinned here is that the activity service asks it about THIS
// session, since passing a constant would read as working right up to the clear.
describe("publishActivity's reply refresh", () => {
  const endATurn = () => {
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionActivity(makeDeps()).setWaiting(ID, true, "Stop");
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
