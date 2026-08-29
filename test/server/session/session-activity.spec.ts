// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionActivity, type ActivityServiceDeps } from "../../../server/session/session-activity.js";
import { activity, lastPrompts, lastResponses } from "../../../server/session/activity-store.js";
import { viewerPtys } from "../../../server/session/viewer-state.js";
import { clearedTranscripts } from "../../../server/session/cleared-transcripts.js";

vi.mock("../../../server/session/session-reads.js", () => ({ readLatestResponse: vi.fn(() => "reply on disk") }));

const ID = "11111111-2222-4333-8444-555555555555";
const makeDeps = (overrides: Partial<ActivityServiceDeps> = {}): ActivityServiceDeps => ({
  publish: vi.fn(),
  forgetWorkPhase: vi.fn(),
  coreMetadataOf: vi.fn(() => ({ cwd: "/work", agent: "claude" as const })),
  ...overrides,
});
const entry = (over: Record<string, unknown> = {}) => ({ cwd: "/work", agent: "claude", ...over }) as never;

beforeEach(() => {
  for (const map of [activity, lastPrompts, lastResponses, viewerPtys]) map.clear();
  clearedTranscripts.clear();
});
afterEach(() => {
  for (const map of [activity, lastPrompts, lastResponses, viewerPtys]) map.clear();
  clearedTranscripts.clear();
});

describe("session activity", () => {
  it("pushes work phase and transcript extras on an actual change, then suppresses identical repeats", async () => {
    const sessionExtrasOf = vi.fn(async () => ({
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
      context: { model: "claude-opus-4-8", contextTokens: 5 },
    }));
    const serviceDeps = makeDeps({ workPhaseOf: () => "planning", sessionExtrasOf });
    const service = createSessionActivity(serviceDeps);

    service.setWorking(ID, true, "UserPromptSubmit");
    await vi.waitFor(() => expect(serviceDeps.publish).toHaveBeenCalledTimes(2));
    expect(serviceDeps.publish).toHaveBeenCalledWith("sessions", expect.objectContaining({ id: ID, working: true, workPhase: "planning" }));
    expect(serviceDeps.publish).toHaveBeenCalledWith(
      "sessions",
      expect.objectContaining({ id: ID, usage: expect.objectContaining({ inputTokens: 1 }), context: expect.objectContaining({ contextTokens: 5 }) }),
    );

    service.publishActivity(ID);
    await vi.waitFor(() => expect(sessionExtrasOf).toHaveBeenCalledTimes(2));
    expect(serviceDeps.publish).toHaveBeenCalledTimes(2);
  });

  it("publishes only changed UI flags", () => {
    const serviceDeps = makeDeps();
    viewerPtys.set(ID, entry());
    const service = createSessionActivity(serviceDeps);
    service.setWorking(ID, true, "UserPromptSubmit");
    lastPrompts.set(ID, "prompt");
    lastResponses.set(ID, "response");
    service.setWorking(ID, true, "UserPromptSubmit");
    expect(activity.get(ID)?.working).toBe(true);
    expect(serviceDeps.publish).toHaveBeenCalledTimes(1);
  });

  it("applies Stop immediately without child-process defer timers", () => {
    const serviceDeps = makeDeps();
    viewerPtys.set(ID, entry());
    const service = createSessionActivity(serviceDeps);
    service.setWorking(ID, true, "UserPromptSubmit");
    service.setWaiting(ID, true, "Stop");
    service.setWorking(ID, false, "Stop");
    expect(activity.get(ID)).toMatchObject({ working: false, waiting: true, event: "Stop" });
    expect(serviceDeps.publish).toHaveBeenLastCalledWith("sessions", expect.objectContaining({ id: ID, working: false, waiting: true }));
  });

  it("keeps Web Push as an activity consumer", () => {
    const notifyMobileWebPushActivity = vi.fn();
    viewerPtys.set(ID, entry({ agent: "codex" }));
    const service = createSessionActivity(makeDeps({ coreMetadataOf: vi.fn(() => ({ cwd: "/work", agent: "codex" as const })), notifyMobileWebPushActivity }));
    service.setWorking(ID, true, "UserPromptSubmit");
    service.setWaiting(ID, true, "Notification");
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "waiting", sessionId: ID, agent: "codex" });
  });

  it("refreshes the displayed reply at turn end but not after transcript clear", () => {
    viewerPtys.set(ID, entry());
    const service = createSessionActivity(makeDeps());
    service.setWaiting(ID, true, "Stop");
    expect(lastResponses.get(ID)).toBe("reply on disk");
    lastResponses.set(ID, "");
    clearedTranscripts.add(ID);
    service.setWaiting(ID, false);
    service.setWaiting(ID, true, "Stop");
    expect(lastResponses.get(ID)).toBe("");
  });

  it("terminalizes display state on Core exit without releasing the viewer", () => {
    let workPhase: "implementing" | null = "implementing";
    const serviceDeps = makeDeps({
      workPhaseOf: () => workPhase,
      forgetWorkPhase: vi.fn(() => {
        workPhase = null;
      }),
    });
    viewerPtys.set(ID, entry());
    const service = createSessionActivity(serviceDeps);
    service.setWorking(ID, true, "UserPromptSubmit");
    (serviceDeps.publish as ReturnType<typeof vi.fn>).mockClear();
    service.endSessionActivity(ID);
    expect(serviceDeps.publish).toHaveBeenCalledWith(
      "sessions",
      expect.objectContaining({ id: ID, working: false, waiting: false, event: "exited", workPhase: null, failed: false }),
    );
    expect(activity.has(ID)).toBe(false);
    expect(lastPrompts.has(ID)).toBe(false);
    expect(lastResponses.has(ID)).toBe(false);
    expect(serviceDeps.forgetWorkPhase).toHaveBeenCalledWith(ID);
    expect(viewerPtys.has(ID)).toBe(true);
  });

  it("drops an older async state read that resolves after the final exit state", async () => {
    const metadataResolvers: Array<(value: { cwd: string; agent: "claude" }) => void> = [];
    const serviceDeps = makeDeps({
      coreMetadataOf: vi.fn(
        () =>
          new Promise<{ cwd: string; agent: "claude" }>((resolve) => {
            metadataResolvers.push(resolve);
          }),
      ),
    });
    const service = createSessionActivity(serviceDeps);

    service.setWorking(ID, true, "UserPromptSubmit");
    service.endSessionActivity(ID);
    metadataResolvers[1]?.({ cwd: "/work", agent: "claude" });
    await vi.waitFor(() => expect(serviceDeps.publish).toHaveBeenCalledTimes(1));
    metadataResolvers[0]?.({ cwd: "/work", agent: "claude" });
    await Promise.resolve();

    expect(serviceDeps.publish).toHaveBeenCalledTimes(1);
    expect(serviceDeps.publish).toHaveBeenCalledWith("sessions", expect.objectContaining({ working: false, event: "exited" }));
  });

  it("cannot change Core membership or invoke Stop/Delete", () => {
    const coreIds = [ID];
    const core = { stop: vi.fn(), delete: vi.fn(), list: vi.fn(() => [...coreIds]) };
    const service = createSessionActivity(makeDeps());
    service.setWorking(ID, true, "UserPromptSubmit");
    service.setWaiting(ID, true, "Notification");
    service.endSessionActivity(ID);
    expect(core.stop).not.toHaveBeenCalled();
    expect(core.delete).not.toHaveBeenCalled();
    expect(core.list()).toEqual([ID]);
  });

  it("publishes explicit Delete as closed before forgetting activity", async () => {
    const serviceDeps = makeDeps();
    activity.set(ID, { working: true, waiting: false, event: "UserPromptSubmit", at: 1 });
    const service = createSessionActivity(serviceDeps);

    service.endSessionActivity(ID, "closed");

    await vi.waitFor(() =>
      expect(serviceDeps.publish).toHaveBeenCalledWith("sessions", expect.objectContaining({ id: ID, working: false, waiting: false, event: "closed" })),
    );
    expect(activity.has(ID)).toBe(false);
  });

  it("uses Core cwd and agent when no viewer entry exists", async () => {
    const notifyMobileWebPushActivity = vi.fn();
    const serviceDeps = makeDeps({
      coreMetadataOf: vi.fn(async () => ({ cwd: "/core/work", agent: "codex" as const })),
      notifyMobileWebPushActivity,
    });
    const service = createSessionActivity(serviceDeps);

    service.setWorking(ID, true, "UserPromptSubmit");
    service.setWaiting(ID, true, "Notification");

    await vi.waitFor(() => expect(serviceDeps.publish).toHaveBeenCalledWith("sessions", expect.objectContaining({ id: ID, cwd: "/core/work" })));
    await vi.waitFor(() => expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "waiting", sessionId: ID, agent: "codex" }));
  });

  it("acknowledges shell output by changing only waiting display state", () => {
    viewerPtys.set(ID, entry({ agent: "shell" }));
    const service = createSessionActivity(makeDeps());
    service.setWaiting(ID, true, "Stop");
    service.acknowledgeShellDone(ID);
    expect(activity.get(ID)).toMatchObject({ waiting: false, event: "Stop" });
  });
});
