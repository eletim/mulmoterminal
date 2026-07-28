import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RateLimitGauge from "../../../src/components/RateLimitGauge.vue";

// The note only reaches a user through the template, and the pure function that produces it can be
// green while nothing renders it. #1011's whole point is that an absent Claude gauge must say why,
// so the wiring is what needs pinning here.

const body = (over: Record<string, unknown>) => ({ claude: null, codex: null, probing: false, ...over });

const serve = (payload: Record<string, unknown>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => payload })),
  );
};

const showGauge = async (payload: Record<string, unknown>) => {
  serve(payload);
  const wrapper = mount(RateLimitGauge);
  await flushPromises();
  return wrapper;
};

const note = (wrapper: Awaited<ReturnType<typeof showGauge>>) => wrapper.find('[data-testid="rate-limit-note"]');

// Relative to now, not a fixed epoch: a hard-coded timestamp silently becomes a PAST reset as the
// clock moves on, and a window whose reset has gone by is deliberately not rendered any more.
const inHours = (h: number) => Math.floor(Date.now() / 1000) + h * 3600;
const limits = { fiveHour: { usedPercentage: 12, resetsAt_sec: inHours(2) }, sevenDay: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RateLimitGauge", () => {
  it("says why the Claude half is missing, with the reason on hover", async () => {
    const wrapper = await showGauge(body({ claudeProbe: "no-claude" }));
    expect(note(wrapper).text()).toBe("claude usage n/a");
    expect(note(wrapper).attributes("title")).toContain("not found on PATH");
    wrapper.unmount();
  });

  it("names the API-key case and the retrying case differently", async () => {
    const noWindows = await showGauge(body({ claudeProbe: "no-windows" }));
    expect(noWindows.get('[data-testid="rate-limit-note"]').attributes("title")).toContain("API-key billing");
    noWindows.unmount();

    const noReport = await showGauge(body({ claudeProbe: "no-report" }));
    expect(noReport.get('[data-testid="rate-limit-note"]').attributes("title")).toContain("Retrying");
    noReport.unmount();
  });

  it("stays silent when nothing has been measured yet, rather than inventing a fault", async () => {
    const wrapper = await showGauge(body({ claudeProbe: "ok" }));
    expect(note(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it("drops the note once the figures arrive", async () => {
    const wrapper = await showGauge(body({ claude: limits, claudeProbe: "ok" }));
    expect(note(wrapper).exists()).toBe(false);
    expect(wrapper.text()).toContain("5h");
    wrapper.unmount();
  });

  // The gap the note was written for and did not cover: a cached reading outlives its window, so
  // uninstalling `claude` used to leave yesterday's percentage on screen saying nothing.
  it("replaces a figure whose window has already reset with the reason", async () => {
    const stale = { fiveHour: { usedPercentage: 83, resetsAt_sec: inHours(-1) }, sevenDay: null };
    const wrapper = await showGauge(body({ claude: stale, claudeProbe: "no-claude" }));

    expect(wrapper.text()).not.toContain("83");
    expect(note(wrapper).attributes("title")).toContain("not found on PATH");
    wrapper.unmount();
  });
});
