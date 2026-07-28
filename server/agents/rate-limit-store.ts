// The last known windows per agent, and the one rule that decides when to spend a query refreshing
// them (#387).
//
// The gauge measures a budget and the Claude probe SPENDS that budget to measure it, so the rule
// has to be demand-driven rather than a timer: a probe runs only when a browser has asked for the
// numbers recently AND what we hold is old. Nobody with the app open means no queries overnight,
// and a user who never opens the grid never pays anything.
//
// Codex is not in that bargain — its windows are read from a rollout file — so it is refreshed
// whenever asked and never gates on staleness.
import type { RateLimits } from "./statusline.js";

export type RateLimitAgent = "claude" | "codex";

export interface AgentRateLimits {
  limits: RateLimits;
  reportedAt_ms: number;
}

export type RateLimitSnapshot = Partial<Record<RateLimitAgent, AgentRateLimits>>;

// How old a reading may be before asking is worth another query. The 5h window moves over hours,
// so a minute of lag costs the reader nothing while a tighter loop would spend real budget.
export const RATE_LIMIT_STALE_MS = 10 * 60_000;

/**
 * Whether a Claude probe is worth spawning now. Both halves matter and neither is optional:
 * `askedAt` proves someone is looking, `reportedAt` proves what we have is old. A probe that runs
 * on a timer alone burns the user's window while they sleep.
 */
export function shouldProbe(now_ms: number, reportedAt_ms: number | null, lastAskedAt_ms: number | null, probeInFlight: boolean): boolean {
  if (probeInFlight) return false;
  if (lastAskedAt_ms === null || now_ms - lastAskedAt_ms > RATE_LIMIT_STALE_MS) return false;
  return reportedAt_ms === null || now_ms - reportedAt_ms > RATE_LIMIT_STALE_MS;
}

export function createRateLimitStore(initial: RateLimitSnapshot = {}, onChange: (snapshot: RateLimitSnapshot) => void = () => {}) {
  const byAgent: RateLimitSnapshot = { ...initial };
  let lastAskedAt_ms: number | null = null;
  let probeInFlight = false;

  return {
    /** A payload without the windows is routine — before the first API response, or API-key
     * billing — so it leaves the last known reading alone rather than blanking the gauge. */
    report(agent: RateLimitAgent, limits: RateLimits | null, now_ms: number): void {
      if (!limits) return;
      byAgent[agent] = { limits, reportedAt_ms: now_ms };
      onChange({ ...byAgent });
    },
    snapshot(): RateLimitSnapshot {
      return { ...byAgent };
    },
    /** Called by the GET route: reading the gauge is what registers the demand that permits the
     * next probe. */
    noteAsked(now_ms: number): void {
      lastAskedAt_ms = now_ms;
    },
    wantsProbe(now_ms: number): boolean {
      return shouldProbe(now_ms, byAgent.claude?.reportedAt_ms ?? null, lastAskedAt_ms, probeInFlight);
    },
    setProbeInFlight(inFlight: boolean): void {
      probeInFlight = inFlight;
    },
    /** Told to the browser so it can wait for the probe instead of sleeping through it: the probe
     * takes the better part of a minute, so a client on its normal interval would paint an
     * incomplete gauge and leave it that way for minutes. */
    isProbing(): boolean {
      return probeInFlight;
    },
  };
}

export type RateLimitStore = ReturnType<typeof createRateLimitStore>;
