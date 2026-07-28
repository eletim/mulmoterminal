import { describe, it, expect } from "vitest";
import { agentGauges, gaugeWindows, gaugeTitle, resetsIn, claudeProbeNote, WARN_PERCENT } from "../../../src/composables/rateLimitGauge";
import type { RateLimitSnapshot } from "../../../src/composables/rateLimitGauge";

const window = (usedPercentage: number, resetsAt_sec: number | null = null) => ({ usedPercentage, resetsAt_sec });
const NOW = 1_700_000_000_000;

describe("gaugeWindows", () => {
  it("shows both windows in reading order, rounded", () => {
    expect(gaugeWindows({ fiveHour: window(26.6), sevenDay: window(83.2) })).toEqual([
      { label: "5h", percent: 27, warn: false },
      { label: "7d", percent: 83, warn: true },
    ]);
  });

  // The rule the whole feature rests on. A window we cannot see is not an empty one — rendering
  // 0% would tell the reader they have everything left at the moment we can least prove it.
  it("omits a window rather than showing it as zero", () => {
    expect(gaugeWindows({ fiveHour: null, sevenDay: window(40) })).toEqual([{ label: "7d", percent: 40, warn: false }]);
    expect(gaugeWindows(null)).toEqual([]);
  });

  it("marks a window at the warning threshold, not only past it", () => {
    expect(gaugeWindows({ fiveHour: window(WARN_PERCENT), sevenDay: null })[0].warn).toBe(true);
    expect(gaugeWindows({ fiveHour: window(WARN_PERCENT - 1), sevenDay: null })[0].warn).toBe(false);
  });

  // 0 is a real reading and must render; only ABSENCE is hidden. Losing this would blank the
  // gauge at the start of every window, which is when it is most reassuring.
  it("shows a genuine zero", () => {
    expect(gaugeWindows({ fiveHour: window(0), sevenDay: null })).toEqual([{ label: "5h", percent: 0, warn: false }]);
  });
});

describe("agentGauges", () => {
  const claudeOnly = { claude: { fiveHour: window(27), sevenDay: null }, codex: null };

  // A user of one tool should not have to read a label that distinguishes nothing.
  it("marks neither agent when only one reports", () => {
    expect(agentGauges(claudeOnly)).toEqual([{ agent: "claude", marked: false, windows: [{ label: "5h", percent: 27, warn: false }] }]);
  });

  it("marks both once both report", () => {
    const both = { claude: claudeOnly.claude, codex: { fiveHour: window(6), sevenDay: null } };
    expect(agentGauges(both).map((g) => g.marked)).toEqual([true, true]);
  });

  // Which is also what "codex is not installed" looks like from here — there is nothing separate
  // to render for a tool the user does not use.
  it("drops an agent with nothing to report", () => {
    expect(agentGauges({ claude: null, codex: null })).toEqual([]);
    expect(agentGauges(null)).toEqual([]);
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
    expect(claudeProbeNote(snap({ claude: { fiveHour: { usedPercentage: 5, resetsAt_sec: null }, sevenDay: null }, claudeProbe: "no-report" }))).toBeNull();
  });

  it("says nothing when it simply has not been measured yet", () => {
    expect(claudeProbeNote(snap())).toBeNull();
    expect(claudeProbeNote(snap({ claudeProbe: "ok" }))).toBeNull();
    expect(claudeProbeNote(null)).toBeNull();
  });

  it("names the reason when there is one", () => {
    expect(claudeProbeNote(snap({ claudeProbe: "no-claude" }))).toContain("PATH");
    expect(claudeProbeNote(snap({ claudeProbe: "no-windows" }))).toContain("API-key");
    expect(claudeProbeNote(snap({ claudeProbe: "no-report" }))).toContain("Retrying");
  });
});
