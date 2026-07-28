import { describe, it, expect } from "vitest";
import { createRateLimitStore, shouldProbe, probeRetryDelay, PROBE_RETRY_BASE_MS, PROBE_RETRY_MAX_MS, RATE_LIMIT_STALE_MS } from "./rate-limit-store";
import type { ProbeState } from "./rate-limit-store";

const NOW = 1_700_000_000_000;
const fresh = NOW - 1000;
const old = NOW - RATE_LIMIT_STALE_MS - 1;
const limits = { fiveHour: { usedPercentage: 27, resetsAt_sec: 1 }, sevenDay: null };

// Defaults describe the case the gauge is built for: someone is watching, the reading is stale,
// nothing has gone wrong. Each test names only what it changes.
const gate = (over: Partial<Parameters<typeof shouldProbe>[1]> = {}) => ({
  reportedAt_ms: old,
  lastAskedAt_ms: fresh,
  probeInFlight: false,
  lastProbeAt_ms: null,
  state: { kind: "ok" } as ProbeState,
  ...over,
});

// The probe spends the very budget the gauge reports, so "when may it run" is the rule that keeps
// the feature honest rather than a tuning knob.
describe("shouldProbe", () => {
  it("probes when someone is looking and what we hold is old", () => {
    expect(shouldProbe(NOW, gate({ reportedAt_ms: old }))).toBe(true);
  });

  it("probes when we hold nothing at all, provided someone is looking", () => {
    expect(shouldProbe(NOW, gate({ reportedAt_ms: null }))).toBe(true);
  });

  // The half that stops the feature costing anything overnight. A timer alone would burn the
  // user's window while they sleep, to refresh a number nobody is reading.
  it("does NOT probe when nobody has asked recently, however old the reading is", () => {
    expect(shouldProbe(NOW, gate({ reportedAt_ms: old, lastAskedAt_ms: old }))).toBe(false);
    expect(shouldProbe(NOW, gate({ reportedAt_ms: null, lastAskedAt_ms: null }))).toBe(false);
  });

  it("does NOT probe while what we hold is still fresh", () => {
    expect(shouldProbe(NOW, gate({ reportedAt_ms: fresh }))).toBe(false);
  });

  // A probe takes a session spawn and an API round trip. Without this, every poll during that
  // window starts another one.
  it("does NOT probe while one is already running", () => {
    expect(shouldProbe(NOW, gate({ reportedAt_ms: old, probeInFlight: true }))).toBe(false);
  });
});

// #1011: a probe that brought nothing back left `reportedAt_ms` untouched, so the staleness test
// stayed true and the next poll started another one — 21 probes in half an hour, each spending the
// budget the gauge exists to report. The gap between attempts is what stops that, so it belongs
// with the rule rather than with the caller.
describe("shouldProbe after a failure", () => {
  const failed = (failures: number): ProbeState => ({ kind: "no-report", failures });

  it("does NOT probe again immediately after one came back empty", () => {
    expect(shouldProbe(NOW, gate({ state: failed(1), lastProbeAt_ms: NOW - 1000 }))).toBe(false);
  });

  it("probes again once the gap has passed", () => {
    expect(shouldProbe(NOW, gate({ state: failed(1), lastProbeAt_ms: NOW - PROBE_RETRY_BASE_MS - 1 }))).toBe(true);
  });

  it("widens the gap with each consecutive failure, up to a ceiling", () => {
    expect(probeRetryDelay(1)).toBe(PROBE_RETRY_BASE_MS);
    expect(probeRetryDelay(2)).toBe(PROBE_RETRY_BASE_MS * 2);
    expect(probeRetryDelay(3)).toBe(PROBE_RETRY_BASE_MS * 4);
    expect(probeRetryDelay(99)).toBe(PROBE_RETRY_MAX_MS);
  });

  // An account on API-key billing reports no windows however often it is asked (statusline.ts).
  // Retried, but at the ceiling — not at the failure cadence, and never at 90 seconds.
  it("holds an account with no windows at the ceiling", () => {
    expect(shouldProbe(NOW, gate({ state: { kind: "no-windows" }, lastProbeAt_ms: NOW - PROBE_RETRY_MAX_MS + 1 }))).toBe(false);
    expect(shouldProbe(NOW, gate({ state: { kind: "no-windows" }, lastProbeAt_ms: NOW - PROBE_RETRY_MAX_MS - 1 }))).toBe(true);
  });

  // Spawning cannot help when there is nothing to spawn. Decided before any probe runs.
  it("never probes when claude is not installed", () => {
    expect(shouldProbe(NOW, gate({ state: { kind: "no-claude" }, lastProbeAt_ms: null }))).toBe(false);
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

// The four things that can go wrong are not interchangeable, and the store is where they are told
// apart (#1011). Getting this wrong is what made every one of them retry at 90 seconds.
describe("probe outcomes", () => {
  const store = () => createRateLimitStore();

  it("a status line WITH windows is success — and clears an earlier failure", () => {
    const s = store();
    s.noteProbeStarted(NOW - 2000);
    s.noteProbeFailedIfNoReport(NOW);
    expect(s.probeState().kind).toBe("no-report");
    s.noteProbeStarted(NOW - 1000);
    s.report("claude", limits, NOW);
    expect(s.probeState()).toEqual({ kind: "ok" });
  });

  // The distinction #1011 turned on: the status line ARRIVED, carrying no windows. That is an
  // answer, not silence, and it will be the same answer every time (API-key billing).
  it("a status line WITHOUT windows is 'no windows', not a failure", () => {
    const s = store();
    s.noteProbeStarted(NOW - 1000);
    s.report("claude", null, NOW);
    expect(s.probeState()).toEqual({ kind: "no-windows" });
    s.noteProbeFailedIfNoReport(NOW);
    expect(s.probeState()).toEqual({ kind: "no-windows" });
  });

  it("counts consecutive silences", () => {
    const s = store();
    s.noteProbeStarted(NOW - 2000);
    s.noteProbeFailedIfNoReport(NOW - 1500);
    s.noteProbeStarted(NOW - 1000);
    s.noteProbeFailedIfNoReport(NOW);
    expect(s.probeState()).toEqual({ kind: "no-report", failures: 2 });
  });

  // Codex review on #1019: `no-claude` refuses to probe, so a check that only ran inside the probe
  // path could never clear itself — installing claude left the gauge unavailable until a restart.
  // The availability answer therefore comes from the caller on every poll, not from the probe.
  it("a missing claude is its own state, and clears the moment one appears", () => {
    const s = store();
    s.noteAsked(NOW);
    s.setClaudeAvailable(false);
    expect(s.probeState()).toEqual({ kind: "no-claude" });
    expect(s.wantsProbe(NOW)).toBe(false);
    s.setClaudeAvailable(true);
    expect(s.probeState()).toEqual({ kind: "ok" });
    expect(s.wantsProbe(NOW)).toBe(true);
  });

  it("does not erase a real failure just because claude is still installed", () => {
    const s = store();
    s.noteProbeStarted(NOW - 1000);
    s.noteProbeFailedIfNoReport(NOW);
    s.setClaudeAvailable(true);
    expect(s.probeState()).toEqual({ kind: "no-report", failures: 1 });
  });

  // The gap runs from when the attempt ENDED. Measured from the start it would be no gap at all
  // for the first retry: a probe times out after 90 seconds and the first delay is also 90, so the
  // retry would fire the moment the timeout landed — the cadence #1011 reported.
  it("waits a full gap after the attempt ended, not after it began", () => {
    const s = store();
    s.noteAsked(NOW);
    s.noteProbeStarted(NOW);
    // the probe times out 90s later
    s.noteProbeFailedIfNoReport(NOW + PROBE_RETRY_BASE_MS);
    expect(s.wantsProbe(NOW + PROBE_RETRY_BASE_MS + 1)).toBe(false);
    expect(s.wantsProbe(NOW + 2 * PROBE_RETRY_BASE_MS + 1)).toBe(true);
  });

  // The whole point of stamping the attempt: without it the next poll starts another probe.
  it("stops wanting a probe the moment one has been started", () => {
    const s = store();
    s.noteAsked(NOW);
    expect(s.wantsProbe(NOW)).toBe(true);
    s.noteProbeStarted(NOW);
    s.noteProbeFailedIfNoReport(NOW);
    expect(s.wantsProbe(NOW + 1000)).toBe(false);
    expect(s.wantsProbe(NOW + PROBE_RETRY_BASE_MS + 1)).toBe(true);
  });
});
