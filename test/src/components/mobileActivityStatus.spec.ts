import { describe, it, expect } from "vitest";
import { mobileActivityStatus } from "../../../src/components/mobileActivityStatus";
import { activityStatus } from "../../../src/components/attentionStatus";

describe("mobileActivityStatus", () => {
  it("is running when working with no known phase", () => {
    expect(mobileActivityStatus(true, false, null, null)).toBe("running");
  });

  it("names the phase when working carries one", () => {
    expect(mobileActivityStatus(true, false, null, "planning")).toBe("planning");
    expect(mobileActivityStatus(true, false, null, "implementing")).toBe("implementing");
  });

  // waiting must win over working: Claude/Codex sets both at once for a permission prompt or
  // question mid-turn ({ working: true, waiting: true, event: "Notification" }), and that
  // combination means the agent is blocked on the user, not merely busy. The desktop roster's
  // activityStatus() already checks waiting first — this used to disagree with it.
  it("waiting wins over working — a permission pause mid-turn reads as needs input, not running", () => {
    expect(mobileActivityStatus(true, true, "Notification", null)).toBe("needs input");
  });

  it("a Stop wait mid-turn reads as done, not running", () => {
    expect(mobileActivityStatus(true, true, "Stop", null)).toBe("done");
  });

  it("splits waiting into needs input (Notification) vs done (Stop)", () => {
    expect(mobileActivityStatus(false, true, "Notification", null)).toBe("needs input");
    expect(mobileActivityStatus(false, true, "Stop", null)).toBe("done");
  });

  // Any other event alongside waiting reads as done, the same as the desktop roster's
  // activityStatus() (blocked only for "Notification"; anything else waiting is done — the safer
  // reading, since it doesn't claim the session is stuck).
  it("falls back to done for any other event alongside waiting", () => {
    expect(mobileActivityStatus(false, true, null, null)).toBe("done");
    expect(mobileActivityStatus(false, true, "SomethingNew", null)).toBe("done");
  });

  it("is idle when neither working nor waiting", () => {
    expect(mobileActivityStatus(false, false, null, null)).toBe("idle");
  });

  // The required cases from the PR review, gathered in one place.
  it.each([
    [true, true, "Notification", null, "needs input"],
    [true, true, "Stop", null, "done"],
    [true, false, null, "planning", "planning"],
    [true, false, null, "implementing", "implementing"],
    [true, false, null, null, "running"],
    [false, false, null, null, "idle"],
  ] as const)("mobileActivityStatus(%s, %s, %s, %s) => %s", (working, waiting, event, workPhase, expected) => {
    expect(mobileActivityStatus(working, waiting, event, workPhase)).toBe(expected);
  });

  // Ties the mapping back to the desktop roster's own function: whenever activityStatus() calls a
  // combination blocked/done/idle, mobileActivityStatus() must agree (working only refines
  // activityStatus()'s "working" into a phase — it never overrides blocked/done/idle).
  it("agrees with the desktop roster's activityStatus() on blocked/done/idle", () => {
    const cases: Array<[boolean, boolean, string | null]> = [
      [true, true, "Notification"],
      [true, true, "Stop"],
      [true, true, "SomethingElse"],
      [false, true, "Notification"],
      [false, true, "Stop"],
      [false, false, null],
    ];
    for (const [working, waiting, event] of cases) {
      const desktop = activityStatus(working, waiting, event);
      const mobile = mobileActivityStatus(working, waiting, event, null);
      if (desktop === "blocked") expect(mobile).toBe("needs input");
      else if (desktop === "done") expect(mobile).toBe("done");
      else if (desktop === "idle") expect(mobile).toBe("idle");
      else expect(mobile).toBe("running"); // desktop's plain "working", mobile's phase-less default
    }
  });
});
