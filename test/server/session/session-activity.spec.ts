// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionActivity, type ActivityServiceDeps } from "../../../server/session/session-activity.js";
import { activity, lastPrompts, lastResponses, ptys } from "../../../server/session/registry.js";
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
  for (const map of [activity, lastPrompts, lastResponses, ptys]) map.clear();
  clearedTranscripts.clear();
});
afterEach(() => {
  for (const map of [activity, lastPrompts, lastResponses, ptys]) map.clear();
  clearedTranscripts.clear();
});

describe("session activity", () => {
  it("publishes only changed UI flags", () => {
    const serviceDeps = makeDeps();
    ptys.set(ID, entry());
    const service = createSessionActivity(serviceDeps);
    service.setWorking(ID, true, "UserPromptSubmit");
    service.setWorking(ID, true, "UserPromptSubmit");
    expect(activity.get(ID)?.working).toBe(true);
    expect(serviceDeps.publish).toHaveBeenCalledTimes(1);
  });

  it("applies Stop immediately without child-process defer timers", () => {
    const serviceDeps = makeDeps();
    ptys.set(ID, entry());
    const service = createSessionActivity(serviceDeps);
    service.setWorking(ID, true, "UserPromptSubmit");
    service.setWaiting(ID, true, "Stop");
    service.setWorking(ID, false, "Stop");
    expect(activity.get(ID)).toMatchObject({ working: false, waiting: true, event: "Stop" });
    expect(serviceDeps.publish).toHaveBeenLastCalledWith("sessions", expect.objectContaining({ id: ID, working: false, waiting: true }));
  });

  it("keeps Web Push as an activity consumer", () => {
    const notifyMobileWebPushActivity = vi.fn();
    ptys.set(ID, entry({ agent: "codex" }));
    const service = createSessionActivity(makeDeps({ coreMetadataOf: vi.fn(() => ({ cwd: "/work", agent: "codex" as const })), notifyMobileWebPushActivity }));
    service.setWorking(ID, true, "UserPromptSubmit");
    service.setWaiting(ID, true, "Notification");
    expect(notifyMobileWebPushActivity).toHaveBeenCalledWith({ kind: "waiting", sessionId: ID, agent: "codex" });
  });

  it("refreshes the displayed reply at turn end but not after transcript clear", () => {
    ptys.set(ID, entry());
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
    const serviceDeps = makeDeps();
    ptys.set(ID, entry());
    const service = createSessionActivity(serviceDeps);
    service.setWorking(ID, true, "UserPromptSubmit");
    (serviceDeps.publish as ReturnType<typeof vi.fn>).mockClear();
    service.endSessionActivity(ID);
    expect(serviceDeps.publish).toHaveBeenCalledWith(
      "sessions",
      expect.objectContaining({ id: ID, working: false, waiting: false, event: "exited", failed: false }),
    );
    expect(activity.has(ID)).toBe(false);
    expect(serviceDeps.forgetWorkPhase).toHaveBeenCalledWith(ID);
    expect(ptys.has(ID)).toBe(true);
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
    ptys.set(ID, entry({ agent: "shell" }));
    const service = createSessionActivity(makeDeps());
    service.setWaiting(ID, true, "Stop");
    service.acknowledgeShellDone(ID);
    expect(activity.get(ID)).toMatchObject({ waiting: false, event: "Stop" });
  });
});
