// What the header actually shows, decided away from the component so the rules are testable
// without mounting anything (#387).
//
// The one rule that outranks the rest: a window we do not have is NOT zero. The percentage is a
// budget already spent, so rendering 0% for missing data tells the reader they have everything
// left at the exact moment we cannot see how much they have — and upstream has dropped the field
// before (anthropics/claude-code#40094). Missing renders nothing at all.

import type { RateLimits, RateLimitWindow } from "../../common/rateLimits";

export type { RateLimits, RateLimitWindow };

export interface RateLimitSnapshot {
  claude: RateLimits | null;
  codex: RateLimits | null;
}

export interface GaugeWindow {
  label: string;
  percent: number;
  /** Past this, the window is close enough to matter more than the other readings around it. */
  warn: boolean;
}

// Where "you should look at this" begins. Under it the number is information; over it, it is the
// thing that will stop the work.
export const WARN_PERCENT = 75;

const gaugeWindow = (label: string, window: RateLimitWindow | null): GaugeWindow[] =>
  window === null ? [] : [{ label, percent: Math.round(window.usedPercentage), warn: window.usedPercentage >= WARN_PERCENT }];

/** The windows to render for one agent, in the order they are shown. Empty when the agent has
 * reported nothing — which covers "not installed", "API-key billing" and "no session yet" alike,
 * because there is nothing worth saying differently about any of them. */
export function gaugeWindows(limits: RateLimits | null): GaugeWindow[] {
  if (!limits) return [];
  return [...gaugeWindow("5h", limits.fiveHour), ...gaugeWindow("7d", limits.sevenDay)];
}

export interface AgentGauge {
  agent: "claude" | "codex";
  /** Drawn only when BOTH agents have something: one row needs nothing to distinguish it from
   * (see AgentMark.vue for why the mark is drawn rather than picked from the icon set). */
  marked: boolean;
  windows: GaugeWindow[];
}

/**
 * The whole readout. An agent with nothing to show is dropped rather than rendered empty, and the
 * agent mark appears only when there are two — a solo user of either tool should not have to read
 * a symbol that distinguishes nothing.
 */
export function agentGauges(snapshot: RateLimitSnapshot | null): AgentGauge[] {
  const claude = gaugeWindows(snapshot?.claude ?? null);
  const codex = gaugeWindows(snapshot?.codex ?? null);
  const both = claude.length > 0 && codex.length > 0;
  return [
    ...(claude.length ? [{ agent: "claude" as const, marked: both, windows: claude }] : []),
    ...(codex.length ? [{ agent: "codex" as const, marked: both, windows: codex }] : []),
  ];
}

const MS_PER_SEC = 1000;
const SEC_PER_MIN = 60;
const MIN_PER_HOUR = 60;

/** "resets in 2h 15m", or "" when the reset is unknown or already past. The hover text says when
 * the number stops mattering, which is the question that follows "how much is left". */
export function resetsIn(resetsAt_sec: number | null, now_ms: number): string {
  if (resetsAt_sec === null) return "";
  const remaining_min = Math.round((resetsAt_sec * MS_PER_SEC - now_ms) / MS_PER_SEC / SEC_PER_MIN);
  if (remaining_min <= 0) return "";
  const hours = Math.floor(remaining_min / MIN_PER_HOUR);
  const minutes = remaining_min % MIN_PER_HOUR;
  return hours ? `resets in ${hours}h ${minutes}m` : `resets in ${minutes}m`;
}

/** The hover text for one agent — the same numbers plus when each window resets. */
export function gaugeTitle(agent: string, limits: RateLimits | null, now_ms: number): string {
  if (!limits) return "";
  const parts = [
    ...(limits.fiveHour ? [`5h ${Math.round(limits.fiveHour.usedPercentage)}% used${suffix(resetsIn(limits.fiveHour.resetsAt_sec, now_ms))}`] : []),
    ...(limits.sevenDay ? [`7d ${Math.round(limits.sevenDay.usedPercentage)}% used${suffix(resetsIn(limits.sevenDay.resetsAt_sec, now_ms))}`] : []),
  ];
  return parts.length ? `${agent} rate limit — ${parts.join(" · ")}` : "";
}

const suffix = (text: string): string => (text ? `, ${text}` : "");
