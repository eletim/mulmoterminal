import { describe, it, expect } from "vitest";
import { mobileActivityStatus } from "../../../src/components/mobileActivityStatus";

describe("mobileActivityStatus", () => {
  it("is running when working with no known phase", () => {
    expect(mobileActivityStatus(true, false, null, null)).toBe("running");
  });

  it("names the phase when working carries one", () => {
    expect(mobileActivityStatus(true, false, null, "planning")).toBe("planning");
    expect(mobileActivityStatus(true, false, null, "implementing")).toBe("implementing");
  });

  it("working wins over waiting — a permission pause mid-turn still reads as working, not waiting", () => {
    expect(mobileActivityStatus(true, true, "Notification", null)).toBe("running");
  });

  it("splits waiting into needs input (Notification) vs done (Stop)", () => {
    expect(mobileActivityStatus(false, true, "Notification", null)).toBe("needs input");
    expect(mobileActivityStatus(false, true, "Stop", null)).toBe("done");
  });

  it("falls back to plain waiting for any other event", () => {
    expect(mobileActivityStatus(false, true, null, null)).toBe("waiting");
    expect(mobileActivityStatus(false, true, "SomethingNew", null)).toBe("waiting");
  });

  it("is idle when neither working nor waiting", () => {
    expect(mobileActivityStatus(false, false, null, null)).toBe("idle");
  });
});
