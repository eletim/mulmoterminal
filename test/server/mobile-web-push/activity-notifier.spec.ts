// @vitest-environment node
import { describe, it, expect } from "vitest";

import { mobileWebPushKindForActivityTransition } from "../../../server/mobile-web-push/activity-notifier";
import type { Activity } from "../../../server/session/types";

const running: Activity = { working: true, waiting: false, event: "UserPromptSubmit", at: 1 };
const idle: Activity = { working: false, waiting: false, event: "Stop", at: 1 };

describe("mobileWebPushKindForActivityTransition", () => {
  const fresh = () => new Map();

  it("notifies when a running session first becomes blocked on input", () => {
    const state = fresh();
    expect(mobileWebPushKindForActivityTransition(state, "a", undefined, running, "UserPromptSubmit")).toBeNull();
    expect(mobileWebPushKindForActivityTransition(state, "a", running, { ...running, waiting: true, event: "Notification", at: 2 }, "Notification")).toBe(
      "waiting",
    );
  });

  it("notifies when a running session completes", () => {
    const state = fresh();
    expect(mobileWebPushKindForActivityTransition(state, "a", running, { ...running, working: false, event: "Stop", at: 2 }, "Stop")).toBe("finished");
  });

  it("does not report a mid-turn process exit as a finished task", () => {
    const state = fresh();
    expect(mobileWebPushKindForActivityTransition(state, "a", undefined, running, "UserPromptSubmit")).toBeNull();
    expect(mobileWebPushKindForActivityTransition(state, "a", running, { ...running, working: false, event: "UserPromptSubmit", at: 2 }, undefined)).toBeNull();
  });

  it("uses the desktop sound baseline for a Stop even when idle had no activity record", () => {
    const state = fresh();
    expect(mobileWebPushKindForActivityTransition(state, "a", undefined, { waiting: true, event: "Stop", at: 2 }, "Stop")).toBe("finished");
  });

  it("does not notify on first observation of an input wait", () => {
    expect(mobileWebPushKindForActivityTransition(fresh(), "a", undefined, { waiting: true, event: "Notification", at: 2 }, "Notification")).toBeNull();
  });

  it("does not notify when idle state stays idle", () => {
    expect(mobileWebPushKindForActivityTransition(fresh(), "a", idle, { ...idle, working: false, event: "Stop", at: 2 }, "Stop")).toBeNull();
  });

  it("collapses duplicate rows from one Stop", () => {
    const state = fresh();
    expect(mobileWebPushKindForActivityTransition(state, "a", running, { ...running, waiting: true, event: "Stop", at: 2 }, "Stop")).toBe("finished");
    expect(
      mobileWebPushKindForActivityTransition(state, "a", { ...running, waiting: true }, { working: false, waiting: true, event: "Stop", at: 3 }, "Stop"),
    ).toBeNull();
  });

  it("notifies again after the previous input wait clears", () => {
    const state = fresh();
    expect(mobileWebPushKindForActivityTransition(state, "a", undefined, running, "UserPromptSubmit")).toBeNull();
    expect(mobileWebPushKindForActivityTransition(state, "a", running, { ...running, waiting: true, event: "Notification", at: 2 }, "Notification")).toBe(
      "waiting",
    );
    expect(
      mobileWebPushKindForActivityTransition(
        state,
        "a",
        { ...running, waiting: true },
        { ...running, waiting: false, event: "Notification", at: 3 },
        undefined,
      ),
    ).toBeNull();
    expect(
      mobileWebPushKindForActivityTransition(
        state,
        "a",
        { ...running, waiting: false },
        { ...running, waiting: true, event: "Notification", at: 4 },
        "Notification",
      ),
    ).toBe("waiting");
  });
});
