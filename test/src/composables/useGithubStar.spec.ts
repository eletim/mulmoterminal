import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, type ComputedRef } from "vue";
import { mount, flushPromises } from "@vue/test-utils";

// The composable keeps its state at module scope (one shared button across both toolbars) and
// reads localStorage on import, so each mount re-imports it — which is also how a second call
// stands in for a second page load, against whatever localStorage the first one left behind.
async function mountStar() {
  vi.resetModules();
  const { useGithubStar } = await import("../../../src/composables/useGithubStar");
  let star!: { visible: ComputedRef<boolean>; confirming: { value: boolean }; title: ComputedRef<string>; activate: () => Promise<void> };
  mount(
    defineComponent({
      setup() {
        star = useGithubStar();
        return () => h("div");
      },
    }),
  );
  await flushPromises();
  return star;
}

const answering = (starred: boolean | null) => vi.fn(async () => ({ ok: true, json: async () => ({ starred }) }));
const DONE_KEY = "github_star_done";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useGithubStar", () => {
  it("offers the button when the repo is not starred yet", async () => {
    vi.stubGlobal("fetch", answering(false));
    const star = await mountStar();
    expect(star.visible.value).toBe(true);
    expect(star.title.value).toBe("Star MulmoTerminal on GitHub");
  });

  // The whole point of the feature: someone who already starred never sees the ask.
  it("stays hidden — and retires for good — when the repo is already starred", async () => {
    vi.stubGlobal("fetch", answering(true));
    const star = await mountStar();
    expect(star.visible.value).toBe(false);
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
  });

  // No `gh` means one click cannot star anything, so there is nothing to offer.
  it("stays hidden when the server cannot tell", async () => {
    vi.stubGlobal("fetch", answering(null));
    const star = await mountStar();
    expect(star.visible.value).toBe(false);
  });

  it("stays hidden when the request fails outright", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const star = await mountStar();
    expect(star.visible.value).toBe(false);
  });

  // The reason nothing is written down while `gh` is missing: retiring on anything short of real
  // evidence would hide the button from exactly the people who have not starred, permanently.
  it("records nothing while gh cannot answer, so installing gh later brings the button back", async () => {
    vi.stubGlobal("fetch", answering(null));
    expect((await mountStar()).visible.value).toBe(false);
    expect(localStorage.getItem(DONE_KEY)).toBeNull();

    // `gh auth login` happened; the next page load gets a real answer.
    vi.stubGlobal("fetch", answering(false));
    expect((await mountStar()).visible.value).toBe(true);
  });

  // A retired button must cost nothing at all — not even the state request on every page load.
  it("asks the server nothing once it has been retired", async () => {
    localStorage.setItem(DONE_KEY, "1");
    const fetchMock = answering(false);
    vi.stubGlobal("fetch", fetchMock);
    const star = await mountStar();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(star.visible.value).toBe(false);
  });

  it("stars on click, confirms briefly, then retires", async () => {
    vi.stubGlobal("fetch", answering(false));
    const star = await mountStar();
    // Only after the mount has settled: `flushPromises` schedules on setImmediate/setTimeout,
    // which fake timers would hold, so the fakes are for the confirmation window alone.
    vi.useFakeTimers();

    vi.stubGlobal("fetch", answering(true));
    await star.activate();
    // Still on screen and confirmed — vanishing on the click itself reads as "nothing happened".
    expect(star.confirming.value).toBe(true);
    expect(star.visible.value).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    expect(star.visible.value).toBe(false);
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
  });

  it("sends one request when clicked twice", async () => {
    vi.stubGlobal("fetch", answering(false));
    const star = await mountStar();
    vi.useFakeTimers();

    const post = answering(true);
    vi.stubGlobal("fetch", post);
    await Promise.all([star.activate(), star.activate()]);
    expect(post).toHaveBeenCalledOnce();
  });

  // `gh` can stop working between the read and the click (auth expired, network died). The click
  // must stay repeatable rather than silently retire or vanish.
  it("stays visible and unrecorded when starring fails", async () => {
    vi.stubGlobal("fetch", answering(false));
    const star = await mountStar();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    await star.activate();
    expect(star.visible.value).toBe(true);
    expect(star.confirming.value).toBe(false);
    expect(localStorage.getItem(DONE_KEY)).toBeNull();
  });
});
