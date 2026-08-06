// @vitest-environment node
import { describe, it, expect } from "vitest";

import { mobileWebPushKindForActivityTransition } from "../../../server/mobile-web-push/activity-notifier";
import type { Activity } from "../../../server/session/types";

const running: Activity = { working: true, waiting: false, event: "UserPromptSubmit", at: 1 };
const idle: Activity = { working: false, waiting: false, event: "Stop", at: 1 };

describe("mobileWebPushKindForActivityTransition", () => {
  it("notifies when a running session first becomes blocked on input", () => {
    expect(mobileWebPushKindForActivityTransition(running, { ...running, waiting: true, event: "Notification", at: 2 }, "waiting", true, "Notification")).toBe(
      "waiting",
    );
  });

  it("notifies when a running session completes", () => {
    expect(mobileWebPushKindForActivityTransition(running, { ...running, working: false, event: "Stop", at: 2 }, "working", false, "Stop")).toBe("finished");
  });

  it("does not notify on first observation or unrelated events", () => {
    expect(mobileWebPushKindForActivityTransition(undefined, { waiting: true, event: "Notification", at: 2 }, "waiting", true, "Notification")).toBeNull();
    expect(mobileWebPushKindForActivityTransition(running, { ...running, waiting: true, event: "Stop", at: 2 }, "waiting", true, "Stop")).toBeNull();
    expect(mobileWebPushKindForActivityTransition(idle, { ...idle, working: false, event: "Stop", at: 2 }, "working", false, "Stop")).toBeNull();
  });
});
