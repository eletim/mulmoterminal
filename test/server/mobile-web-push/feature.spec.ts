// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

import type { PushKind } from "../../../common/pushKinds";
import type { MobileWebPushSendResult, MobileWebPushSender } from "../../../server/mobile-web-push/sender";

let pushKinds: PushKind[] = ["finished", "waiting"];
const registry = vi.hoisted(() => ({
  isUserScheduledSession: vi.fn<(id: string) => boolean>().mockReturnValue(false),
  userScheduledSessionsHydrated: Promise.resolve(),
}));
const core = vi.hoisted(() => ({ find: vi.fn(async () => ({ visibility: "normal" })) }));

vi.mock("../../../server/config/config-routes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/config/config-routes.js")>()),
  getPushKinds: () => pushKinds,
}));
vi.mock("../../../server/session/registry.js", () => registry);
vi.mock("../../../server/session/core-session-adapter.js", () => ({ coreSessions: core }));

const { mobileWebPushActivityDeps } = await import("../../../server/mobile-web-push/feature.js");

const sender = (): MobileWebPushSender => ({
  sendTest: vi.fn(),
  sendActivity: vi.fn(async (): Promise<MobileWebPushSendResult> => ({ ok: true, sent: 1, failed: 0, targets: 1, removed: 0 })),
});

describe("mobileWebPushActivityDeps", () => {
  beforeEach(() => {
    pushKinds = ["finished", "waiting"];
    registry.isUserScheduledSession.mockReturnValue(false);
    core.find.mockResolvedValue({ visibility: "normal" });
  });

  it("sends selected local Web Push activity kinds without a master switch", async () => {
    pushKinds = ["waiting"];
    const mobileWebPush = sender();
    const deps = mobileWebPushActivityDeps({ sender: mobileWebPush });

    deps.notifyMobileWebPushActivity?.({ kind: "waiting", sessionId: "session-a", agent: "codex" });
    deps.notifyMobileWebPushActivity?.({ kind: "finished", sessionId: "session-a", agent: "codex" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mobileWebPush.sendActivity).toHaveBeenCalledTimes(1);
    expect(mobileWebPush.sendActivity).toHaveBeenCalledWith("waiting", { kind: "waiting", sessionId: "session-a", agent: "codex" });
  });

  it("sends no local Web Push activity when no kinds are selected", async () => {
    pushKinds = [];
    const mobileWebPush = sender();
    const deps = mobileWebPushActivityDeps({ sender: mobileWebPush });

    deps.notifyMobileWebPushActivity?.({ kind: "waiting", sessionId: "session-a", agent: "codex" });
    deps.notifyMobileWebPushActivity?.({ kind: "finished", sessionId: "session-a", agent: "codex" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mobileWebPush.sendActivity).not.toHaveBeenCalled();
  });

  it("uses the same background and translation-worker suppression as existing task push", async () => {
    const mobileWebPush = sender();
    const deps = mobileWebPushActivityDeps({ sender: mobileWebPush });

    core.find.mockResolvedValueOnce({ visibility: "background" });
    deps.notifyMobileWebPushActivity?.({ kind: "finished", sessionId: "background-session", agent: "claude" });
    core.find.mockResolvedValueOnce({ visibility: "internal" });
    deps.notifyMobileWebPushActivity?.({ kind: "finished", sessionId: "translation-session", agent: "claude" });
    core.find.mockResolvedValueOnce({ visibility: "background" });
    registry.isUserScheduledSession.mockImplementation((id: string) => id === "scheduled-session");
    deps.notifyMobileWebPushActivity?.({ kind: "finished", sessionId: "scheduled-session", agent: "claude" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mobileWebPush.sendActivity).toHaveBeenCalledTimes(1);
    expect(mobileWebPush.sendActivity).toHaveBeenCalledWith("finished", { kind: "finished", sessionId: "scheduled-session", agent: "claude" });
  });

  it("does not let async send failures escape activity notification dispatch", async () => {
    const mobileWebPush = sender();
    vi.mocked(mobileWebPush.sendActivity).mockRejectedValueOnce(new Error("push failed"));
    const deps = mobileWebPushActivityDeps({ sender: mobileWebPush });

    expect(() => deps.notifyMobileWebPushActivity?.({ kind: "finished", sessionId: "session-a", agent: "claude" })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mobileWebPush.sendActivity).toHaveBeenCalledTimes(1);
  });
});
