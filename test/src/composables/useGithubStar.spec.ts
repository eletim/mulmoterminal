import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, type ComputedRef } from "vue";
import { mount, flushPromises } from "@vue/test-utils";

// The composable keeps its state at module scope (one shared button across both toolbars) and
// reads localStorage on import, so each case re-imports it against a freshly seeded store.
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
    expect(localStorage.getItem("github_star_done")).toBe("1");
  });

  it("offers a plain link when the server cannot tell", async () => {
    vi.stubGlobal("fetch", answering(null));
    const star = await mountStar();
    expect(star.visible.value).toBe(true);
    expect(star.title.value).toBe("Open MulmoTerminal on GitHub");
  });

  it("offers the link when the request fails outright", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const star = await mountStar();
    expect(star.visible.value).toBe(true);
    expect(star.title.value).toBe("Open MulmoTerminal on GitHub");
  });

  // A retired button must cost nothing at all — not even the state request on every page load.
  it("asks the server nothing once it has been retired", async () => {
    localStorage.setItem("github_star_done", "1");
    const fetchMock = answering(false);
    vi.stubGlobal("fetch", fetchMock);
    const star = await mountStar();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(star.visible.value).toBe(false);
  });

  it("stars on click, confirms briefly, then retires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", answering(false));
    const star = await mountStar();

    vi.stubGlobal("fetch", answering(true));
    await star.activate();
    // Still on screen and confirmed — vanishing on the click itself reads as "nothing happened".
    expect(star.confirming.value).toBe(true);
    expect(star.visible.value).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    expect(star.visible.value).toBe(false);
    expect(localStorage.getItem("github_star_done")).toBe("1");
  });

  it("ignores a second click inside the confirmation window", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", answering(false));
    const star = await mountStar();
    const open = vi.fn();
    vi.stubGlobal("open", open);

    vi.stubGlobal("fetch", answering(true));
    await star.activate();
    await star.activate();
    expect(open).not.toHaveBeenCalled();
  });

  // `gh` can stop working between the read and the click (auth expired, network died). The
  // button must then become the link rather than swallow the click.
  it("degrades to the link when starring fails", async () => {
    vi.stubGlobal("fetch", answering(false));
    const star = await mountStar();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    await star.activate();
    expect(star.visible.value).toBe(true);
    expect(star.title.value).toBe("Open MulmoTerminal on GitHub");
    expect(localStorage.getItem("github_star_done")).toBeNull();
  });

  it("opens the repo page and retires when it is only a link", async () => {
    vi.stubGlobal("fetch", answering(null));
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const star = await mountStar();

    await star.activate();
    expect(open).toHaveBeenCalledWith("https://github.com/receptron/mulmoterminal", "_blank", "noopener");
    expect(star.visible.value).toBe(false);
    expect(localStorage.getItem("github_star_done")).toBe("1");
  });
});
