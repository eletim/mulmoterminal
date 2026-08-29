import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, ref, watch } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useGitStatus } from "../../../src/composables/useGitStatus";
import { useHeaderButtons } from "../../../src/composables/useHeaderButtons";
import { useWorkItem } from "../../../src/composables/useWorkItem";

const responseFor = (url: string): Response => {
  let body: unknown = { buttons: [], chips: null };
  if (url.includes("/api/git-status")) {
    body = { repo: true, branch: "main", detached: false, dirty: 0, ahead: 0, behind: 0, upstream: true };
  } else if (url.includes("/api/pr-phase")) {
    body = { phase: "none", pr: null, prUrl: null, issue: null, issueUrl: null, prTitle: null, issueTitle: null, blockedReason: null };
  }
  return { ok: true, json: async () => body } as Response;
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("active-session repo metadata polling", () => {
  it("publishes no placeholder PR phase before the first successful response", async () => {
    const response = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response.promise),
    );
    const phases: string[] = [];
    const app = createApp(
      defineComponent({
        setup() {
          const { item, resolved } = useWorkItem(ref("/repo"), ref(true));
          watch([item, resolved], ([value, ready]) => {
            if (ready) phases.push(value.phase);
          });
          return () => null;
        },
      }),
    );

    app.mount(document.createElement("div"));
    await flushPromises();
    expect(phases).toEqual([]);

    response.resolve({ ok: true, json: async () => ({ phase: "ci-failing" }) } as Response);
    await flushPromises();
    expect(phases).toEqual(["ci-failing"]);
    app.unmount();
  });

  it("refreshes only while active, immediately on each activation, and leaves no old timer", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => responseFor(String(input)));
    vi.stubGlobal("fetch", fetchMock);
    const active = ref(false);
    const cwd = ref<string | null>("/repo-a");
    const app = createApp(
      defineComponent({
        setup() {
          useGitStatus(cwd, active);
          useWorkItem(cwd, active);
          useHeaderButtons({ cwd, active, session: ref("session-a"), agent: ref("claude") });
          return () => null;
        },
      }),
    );
    app.mount(document.createElement("div"));
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    active.value = true;
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(3);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    active.value = false;
    await flushPromises();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    cwd.value = "/repo-b";
    active.value = true;
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(fetchMock.mock.calls.slice(-3).every(([url]) => String(url).includes(encodeURIComponent("/repo-b")))).toBe(true);

    // Repeated switches must replace, not stack, the active interval.
    active.value = false;
    await flushPromises();
    active.value = true;
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(vi.getTimerCount()).toBe(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(15);

    app.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(15);
  });

  it("pauses requests in a hidden tab and refreshes immediately when it becomes visible", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => responseFor(String(input)));
    vi.stubGlobal("fetch", fetchMock);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const active = ref(true);
    const cwd = ref<string | null>("/repo");
    const app = createApp(
      defineComponent({
        setup() {
          useGitStatus(cwd, active);
          return () => null;
        },
      }),
    );

    app.mount(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledOnce();

    app.unmount();
    visibility.mockRestore();
  });
});
