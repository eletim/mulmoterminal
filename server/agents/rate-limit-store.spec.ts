import { describe, it, expect } from "vitest";
import { createRateLimitStore, shouldProbe, RATE_LIMIT_STALE_MS } from "./rate-limit-store";

const NOW = 1_700_000_000_000;
const fresh = NOW - 1000;
const old = NOW - RATE_LIMIT_STALE_MS - 1;
const limits = { fiveHour: { usedPercentage: 27, resetsAt_sec: 1 }, sevenDay: null };

// The probe spends the very budget the gauge reports, so "when may it run" is the rule that keeps
// the feature honest rather than a tuning knob.
describe("shouldProbe", () => {
  it("probes when someone is looking and what we hold is old", () => {
    expect(shouldProbe(NOW, old, fresh, false)).toBe(true);
  });

  it("probes when we hold nothing at all, provided someone is looking", () => {
    expect(shouldProbe(NOW, null, fresh, false)).toBe(true);
  });

  // The half that stops the feature costing anything overnight. A timer alone would burn the
  // user's window while they sleep, to refresh a number nobody is reading.
  it("does NOT probe when nobody has asked recently, however old the reading is", () => {
    expect(shouldProbe(NOW, old, old, false)).toBe(false);
    expect(shouldProbe(NOW, null, null, false)).toBe(false);
  });

  it("does NOT probe while what we hold is still fresh", () => {
    expect(shouldProbe(NOW, fresh, fresh, false)).toBe(false);
  });

  // A probe takes a session spawn and an API round trip. Without this, every poll during that
  // window starts another one.
  it("does NOT probe while one is already running", () => {
    expect(shouldProbe(NOW, old, fresh, true)).toBe(false);
  });
});

describe("createRateLimitStore", () => {
  it("keeps the last reading per agent, and reports them together", () => {
    const store = createRateLimitStore();
    store.report("claude", limits, NOW);
    store.report("codex", { fiveHour: null, sevenDay: { usedPercentage: 3, resetsAt_sec: 2 } }, NOW);
    expect(store.snapshot().claude?.limits).toEqual(limits);
    expect(store.snapshot().codex?.limits.sevenDay?.usedPercentage).toBe(3);
  });

  // Absent windows are routine: before a session's first API response, and on API-key billing.
  // Blanking on those would read as "0% used", which is the opposite of what is true.
  it("ignores a null report rather than blanking what it holds", () => {
    const store = createRateLimitStore();
    store.report("claude", limits, NOW);
    store.report("claude", null, NOW + 1000);
    expect(store.snapshot().claude?.limits).toEqual(limits);
  });

  it("wants a probe only once someone has asked", () => {
    const store = createRateLimitStore();
    expect(store.wantsProbe(NOW)).toBe(false);
    store.noteAsked(NOW);
    expect(store.wantsProbe(NOW)).toBe(true);
  });

  // The browser is told this so it can wait out the probe instead of painting half a gauge and
  // sleeping through the rest — which is how the feature read as broken the first time it ran.
  it("reports whether a probe is in flight", () => {
    const store = createRateLimitStore();
    expect(store.isProbing()).toBe(false);
    store.setProbeInFlight(true);
    expect(store.isProbing()).toBe(true);
  });

  it("stops wanting one while a probe is in flight, and again once it has reported", () => {
    const store = createRateLimitStore();
    store.noteAsked(NOW);
    store.setProbeInFlight(true);
    expect(store.wantsProbe(NOW)).toBe(false);
    store.setProbeInFlight(false);
    store.report("claude", limits, NOW);
    expect(store.wantsProbe(NOW)).toBe(false);
  });

  // The snapshot is what the route serialises; handing out the live object would let a caller
  // mutate the store by editing its own response.
  it("hands out a copy, not the store's own object", () => {
    const store = createRateLimitStore();
    store.report("claude", limits, NOW);
    const snap = store.snapshot();
    delete snap.claude;
    expect(store.snapshot().claude).toBeTruthy();
  });
});
