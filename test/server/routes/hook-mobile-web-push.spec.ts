// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

import { mountHookRoute } from "../../../server/routes/hook-routes";
import { activity } from "../../../server/session/activity-store.js";
import { viewerPtys } from "../../../server/session/viewer-state.js";

vi.mock("../../../server/session/session-reads.js", () => ({ latestUserPrompt: vi.fn(async () => null) }));

const ID = "11111111-2222-4333-8444-555555555555";

const deps = {
  setWorking: vi.fn(),
  setWaiting: vi.fn(),
  publishActivity: vi.fn(),
  forgetTitle: vi.fn(),
  noteTitleTurn: vi.fn(),
  noteWorkPhase: vi.fn(),
  maybeGenerateTitle: vi.fn(async () => {}),
  recordToolCallStart: vi.fn(async () => {}),
  recordToolCallEnd: vi.fn(async () => {}),
  publishDirConfig: vi.fn(),
  publishFileWrite: vi.fn(),
  notifyMobileWebPushActivity: vi.fn(),
  sessionCwd: vi.fn(async () => "/work"),
  sessionAgent: vi.fn(async () => "codex" as const),
  uiPort: "34567",
};

const app = express();
app.use(express.json());
mountHookRoute(app, deps);

const postHook = (body: Record<string, unknown>) => request(app).post("/api/hook").set("x-mt-session", ID).send(body);
const fakeEntry = (over: Record<string, unknown> = {}) => ({ term: { kill: vi.fn() }, ws: {}, cwd: "/work", tmux: false, agent: "claude", ...over }) as never;

beforeEach(async () => {
  viewerPtys.set(ID, fakeEntry({ active: true, agent: "codex" }));
  activity.set(ID, { working: true, waiting: false, event: "UserPromptSubmit", at: 1 });
  await postHook({ hook_event_name: "PostToolUse" });
  vi.clearAllMocks();
});

afterEach(() => {
  viewerPtys.delete(ID);
  activity.delete(ID);
});

describe("local mobile Web Push from Claude hooks", () => {
  it("notifies for active-pane input waits without setting the roster waiting flag", async () => {
    await postHook({ hook_event_name: "Notification", notification_type: "permission_prompt" });
    await postHook({ hook_event_name: "Notification", notification_type: "permission_prompt" });

    expect(deps.setWaiting).not.toHaveBeenCalled();
    expect(deps.notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
    expect(deps.notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "waiting", sessionId: ID, agent: "codex" });
  });

  it("does not notify for an active-pane input wait before working state has been observed", async () => {
    activity.delete(ID);

    await postHook({ hook_event_name: "Notification", notification_type: "permission_prompt" });

    expect(deps.notifyMobileWebPushActivity).not.toHaveBeenCalled();
  });

  it("does not notify for an active-pane input wait already reported by the lifecycle path", async () => {
    activity.set(ID, { working: true, waiting: true, event: "Notification", at: 1 });

    await postHook({ hook_event_name: "Notification", notification_type: "permission_prompt" });

    expect(deps.notifyMobileWebPushActivity).not.toHaveBeenCalled();
  });

  it("allows a later active-pane input wait after work resumes", async () => {
    await postHook({ hook_event_name: "Notification", notification_type: "permission_prompt" });
    await postHook({ hook_event_name: "PostToolUse" });
    await postHook({ hook_event_name: "Notification", notification_type: "permission_prompt" });

    expect(deps.notifyMobileWebPushActivity).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate inactive waits that lifecycle already reports", async () => {
    viewerPtys.set(ID, fakeEntry({ active: false, agent: "codex" }));

    await postHook({ hook_event_name: "Notification", notification_type: "permission_prompt" });

    expect(deps.setWaiting).toHaveBeenCalledWith(ID, true, "Notification");
    expect(deps.notifyMobileWebPushActivity).not.toHaveBeenCalled();
  });

  it("keeps work-phase tracking for a Core member after its viewer is released", async () => {
    viewerPtys.delete(ID);

    await postHook({ hook_event_name: "PreToolUse", tool_name: "Edit" });

    expect(deps.noteWorkPhase).toHaveBeenCalledWith(ID, "PreToolUse", "Edit");
  });

  it("keeps hook handling isolated from local mobile Web Push dispatch failures", async () => {
    deps.notifyMobileWebPushActivity.mockImplementationOnce(() => {
      throw new Error("push failed");
    });

    const response = await postHook({ hook_event_name: "Notification", notification_type: "permission_prompt" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(deps.notifyMobileWebPushActivity).toHaveBeenCalledTimes(1);
  });
});
