// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

import type { PushKind } from "../../../common/pushKinds";
import type { MobileWebPushSendResult, MobileWebPushSender } from "../../../server/mobile-web-push/sender";

let pushEnabled = false;
let pushKinds: PushKind[] = ["finished", "waiting"];
const registry = vi.hoisted(() => ({
  pushClassification: vi.fn(async () => ({ background: false, userScheduled: false })),
  translationWorkerIds: new Set<string>(),
}));

vi.mock("../../../server/config/config-routes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/config/config-routes.js")>()),
  getPushEnabled: () => pushEnabled,
  getPushKinds: () => pushKinds,
}));
vi.mock("../../../server/session/registry.js", () => registry);

const { mobileWebPushActivityLifecycleDeps } = await import("../../../server/mobile-web-push/feature.js");

const sender = (): MobileWebPushSender => ({
  sendTest: vi.fn(),
  sendActivity: vi.fn(async (): Promise<MobileWebPushSendResult> => ({ ok: true, sent: 1, failed: 0, targets: 1, removed: 0 })),
});

describe("mobileWebPushActivityLifecycleDeps", () => {
  beforeEach(() => {
    pushEnabled = false;
    pushKinds = ["finished", "waiting"];
    registry.pushClassification.mockResolvedValue({ background: false, userScheduled: false });
    registry.translationWorkerIds.clear();
  });

  it("wires no lifecycle notification dependency outside local mobile mode", () => {
    expect(mobileWebPushActivityLifecycleDeps({ mode: "remote", sender: sender() })).toEqual({});
  });

  it("sends only enabled and selected local Web Push activity kinds", async () => {
    pushEnabled = true;
    pushKinds = ["waiting"];
    const mobileWebPush = sender();
    const deps = mobileWebPushActivityLifecycleDeps({ mode: "local", sender: mobileWebPush });

    deps.notifyMobileWebPushActivity?.({ kind: "waiting", sessionId: "session-a", agent: "codex" });
    deps.notifyMobileWebPushActivity?.({ kind: "finished", sessionId: "session-a", agent: "codex" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mobileWebPush.sendActivity).toHaveBeenCalledTimes(1);
    expect(mobileWebPush.sendActivity).toHaveBeenCalledWith("waiting", { kind: "waiting", sessionId: "session-a", agent: "codex" });
  });

  it("uses the same background and translation-worker suppression as existing task push", async () => {
    pushEnabled = true;
    const mobileWebPush = sender();
    const deps = mobileWebPushActivityLifecycleDeps({ mode: "local", sender: mobileWebPush });

    registry.pushClassification.mockResolvedValueOnce({ background: true, userScheduled: false });
    deps.notifyMobileWebPushActivity?.({ kind: "finished", sessionId: "background-session", agent: "claude" });
    registry.translationWorkerIds.add("translation-session");
    deps.notifyMobileWebPushActivity?.({ kind: "finished", sessionId: "translation-session", agent: "claude" });
    registry.pushClassification.mockResolvedValueOnce({ background: true, userScheduled: true });
    deps.notifyMobileWebPushActivity?.({ kind: "finished", sessionId: "scheduled-session", agent: "claude" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mobileWebPush.sendActivity).toHaveBeenCalledTimes(1);
    expect(mobileWebPush.sendActivity).toHaveBeenCalledWith("finished", { kind: "finished", sessionId: "scheduled-session", agent: "claude" });
  });

  it("does not let async send failures escape lifecycle notification dispatch", async () => {
    pushEnabled = true;
    const mobileWebPush = sender();
    vi.mocked(mobileWebPush.sendActivity).mockRejectedValueOnce(new Error("push failed"));
    const deps = mobileWebPushActivityLifecycleDeps({ mode: "local", sender: mobileWebPush });

    expect(() => deps.notifyMobileWebPushActivity?.({ kind: "finished", sessionId: "session-a", agent: "claude" })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mobileWebPush.sendActivity).toHaveBeenCalledTimes(1);
  });
});
