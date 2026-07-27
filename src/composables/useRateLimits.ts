// The gauge's data, polled while the grid header is on screen (#387).
//
// A singleton: the windows are an account-wide budget, so every view shows the same numbers and
// polling them twice would only spend the budget twice.
//
// The poll is a POST, not a GET, and that is deliberate rather than clumsy. Asking is what permits
// the server to spend a Claude query on a probe, and `same-origin-guard.ts` gates POSTs while
// leaving safe methods open — so a GET that triggered a probe could be fired by any page the user
// happens to visit, at their expense.
import { ref } from "vue";
import type { RateLimitSnapshot } from "./rateLimitGauge";

const FETCH_TIMEOUT_MS = 8000;
// The server refuses to probe more often than its own staleness window, so a tighter poll here
// buys nothing; this only has to be often enough that a reader who leaves the tab open sees the
// number move within a few minutes of it actually moving.
const REFRESH_MS = 120_000;

const snapshot = ref<RateLimitSnapshot | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;
let watchers = 0;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseWindow(raw: unknown) {
  if (!isRecord(raw)) return null;
  const used = finite(raw.usedPercentage);
  return used === null ? null : { usedPercentage: used, resetsAt_sec: finite(raw.resetsAt_sec) };
}

function parseLimits(raw: unknown) {
  if (!isRecord(raw)) return null;
  const fiveHour = parseWindow(raw.fiveHour);
  const sevenDay = parseWindow(raw.sevenDay);
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

// A failure leaves the last known windows in place. Blanking them would read as "0% used", which
// is the opposite of the truth we just failed to fetch.
async function load(): Promise<void> {
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/rate-limits/refresh", { method: "POST", signal: controller.signal });
    if (!res.ok) return;
    const data: unknown = await res.json();
    if (!isRecord(data)) return;
    snapshot.value = { claude: parseLimits(data.claude), codex: parseLimits(data.codex) };
  } catch {
    // offline, aborted, or the route is not there — keep what we had
  } finally {
    clearTimeout(abort);
  }
}

/** Reference-counted so two mounted headers do not double the polling — and so the last one
 * leaving actually stops it, which is what keeps the server from probing for nobody. */
export function useRateLimits() {
  return {
    snapshot,
    start(): void {
      watchers++;
      if (timer) return;
      void load();
      timer = setInterval(() => void load(), REFRESH_MS);
    },
    stop(): void {
      watchers = Math.max(0, watchers - 1);
      if (watchers > 0 || !timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
