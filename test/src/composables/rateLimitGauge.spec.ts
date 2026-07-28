import { describe, it, expect } from "vitest";
import { agentGauges, gaugeWindows, gaugeTitle, resetsIn, claudeProbeNote, WARN_PERCENT } from "../../../src/composables/rateLimitGauge";
import type { RateLimitSnapshot } from "../../../src/composables/rateLimitGauge";

const window = (usedPercentage: number, resetsAt_sec: number | null = null) => ({ usedPercentage, resetsAt_sec });
const NOW = 1_700_000_000_000;

describe("gaugeWindows", () => {
  it("shows both windows in reading order, rounded", () => {
    expect(gaugeWindows({ fiveHour: window(26.6), sevenDay: window(83.2) }, NOW)).toEqual([
      { label: "5h", percent: 27, warn: false },
      { label: "7d", percent: 83, warn: true },
    ]);
  });

  // The rule the whole feature rests on. A window we cannot see is not an empty one — rendering
  // 0% would tell the reader they have everything left at the moment we can least prove it.
  it("omits a window rather than showing it as zero", () => {
    expect(gaugeWindows({ fiveHour: null, sevenDay: window(40) }, NOW)).toEqual([{ label: "7d", percent: 40, warn: false }]);
    expect(gaugeWindows(null, NOW)).toEqual([]);
  });

  it("marks a window at the warning threshold, not only past it", () => {
    expect(gaugeWindows({ fiveHour: window(WARN_PERCENT), sevenDay: null }, NOW)[0].warn).toBe(true);
    expect(gaugeWindows({ fiveHour: window(WARN_PERCENT - 1), sevenDay: null }, NOW)[0].warn).toBe(false);
  });

  // 0 is a real reading and must render; only ABSENCE is hidden. Losing this would blank the
  // gauge at the start of every window, which is when it is most reassuring.
  it("shows a genuine zero", () => {
    expect(gaugeWindows({ fiveHour: window(0), sevenDay: null }, NOW)).toEqual([{ label: "5h", percent: 0, warn: false }]);
  });

  // A reading whose window has already reset describes a budget that no longer exists. Kept on
  // screen it reads exactly like today's number — the same failure the "absent is not zero" rule
  // above exists to prevent, arriving from the other direction.
  it("drops a window whose reset has already passed", () => {
    const past = Math.floor(NOW / 1000) - 60;
    const future = Math.floor(NOW / 1000) + 3600;
    expect(gaugeWindows({ fiveHour: window(83, past), sevenDay: window(40, future) }, NOW)).toEqual([{ label: "7d", percent: 40, warn: false }]);
  });

  // Staleness has to be PROVEN, not assumed: without a reset time there is nothing to compare, and
  // dropping the figure would hide a perfectly good reading.
  it("keeps a window whose reset time is unknown", () => {
    expect(gaugeWindows({ fiveHour: window(83, null), sevenDay: null }, NOW)).toEqual([{ label: "5h", percent: 83, warn: true }]);
  });
});

describe("agentGauges", () => {
  const claudeOnly = { claude: { fiveHour: window(27), sevenDay: null }, codex: null };

  // A user of one tool should not have to read a label that distinguishes nothing.
  it("marks neither agent when only one reports", () => {
    expect(agentGauges(claudeOnly, NOW)).toEqual([{ agent: "claude", marked: false, windows: [{ label: "5h", percent: 27, warn: false }] }]);
  });

  it("marks both once both report", () => {
    const both = { claude: claudeOnly.claude, codex: { fiveHour: window(6), sevenDay: null } };
    expect(agentGauges(both, NOW).map((g) => g.marked)).toEqual([true, true]);
  });

  // Which is also what "codex is not installed" looks like from here — there is nothing separate
  // to render for a tool the user does not use.
  it("drops an agent with nothing to report", () => {
    expect(agentGauges({ claude: null, codex: null }, NOW)).toEqual([]);
    expect(agentGauges(null, NOW)).toEqual([]);
  });
});

describe("resetsIn", () => {
  const inMinutes = (m: number) => Math.floor(NOW / 1000) + m * 60;

  it("reads as hours and minutes, or minutes alone", () => {
    expect(resetsIn(inMinutes(135), NOW)).toBe("resets in 2h 15m");
    expect(resetsIn(inMinutes(20), NOW)).toBe("resets in 20m");
  });

  // A stale reading whose reset has passed should say nothing rather than count backwards.
  it("says nothing for an unknown or elapsed reset", () => {
    expect(resetsIn(null, NOW)).toBe("");
    expect(resetsIn(inMinutes(-5), NOW)).toBe("");
  });
});

describe("gaugeTitle", () => {
  it("carries the numbers and when each window resets", () => {
    const title = gaugeTitle("claude", { fiveHour: window(27, Math.floor(NOW / 1000) + 3600), sevenDay: window(83) }, NOW);
    expect(title).toContain("claude rate limit");
    expect(title).toContain("5h 27% used, resets in 1h 0m");
    expect(title).toContain("7d 83% used");
  });

  it("is empty when there is nothing to say", () => {
    expect(gaugeTitle("codex", null, NOW)).toBe("");
    expect(gaugeTitle("codex", { fiveHour: null, sevenDay: null }, NOW)).toBe("");
  });
});

// #1011 / #1010: an absent Claude gauge used to be indistinguishable from a probe loop running
// every 90 seconds in the background. The note is how a user finds out that nothing is coming —
// and, for two of the three reasons, that nothing will come until they change something.
describe("claudeProbeNote", () => {
  const snap = (over: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot => ({ claude: null, codex: null, ...over });

  it("says nothing while the figures are showing", () => {
    expect(
      claudeProbeNote(snap({ claude: { fiveHour: { usedPercentage: 5, resetsAt_sec: null }, sevenDay: null }, claudeProbe: "no-report" }), NOW),
    ).toBeNull();
  });

  it("says nothing when it simply has not been measured yet", () => {
    expect(claudeProbeNote(snap(), NOW)).toBeNull();
    expect(claudeProbeNote(snap({ claudeProbe: "ok" }), NOW)).toBeNull();
    expect(claudeProbeNote(null, NOW)).toBeNull();
  });

  it("names the reason when there is one", () => {
    expect(claudeProbeNote(snap({ claudeProbe: "no-claude" }), NOW)).toContain("PATH");
    expect(claudeProbeNote(snap({ claudeProbe: "no-windows" }), NOW)).toContain("API-key");
    expect(claudeProbeNote(snap({ claudeProbe: "no-report" }), NOW)).toContain("Retrying");
  });

  // The case the note existed for and did not cover. A cached reading survives a restart, so
  // uninstalling `claude` left yesterday's percentage on screen with nothing said — the note was
  // suppressed by the very value that had gone stale.
  it("speaks up when the only reading it holds has already expired", () => {
    const expired = { fiveHour: { usedPercentage: 83, resetsAt_sec: Math.floor(NOW / 1000) - 60 }, sevenDay: null };
    expect(claudeProbeNote(snap({ claude: expired, claudeProbe: "no-claude" }), NOW)).toContain("PATH");
  });
});
