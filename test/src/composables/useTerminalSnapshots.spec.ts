import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalSnapshots } from "../../../src/composables/useTerminalSnapshots";

const ids = Array.from({ length: 5 }, (_, i) => `123e4567-e89b-12d3-a456-42661417400${i}`);
const ok = (screen: string) => ({ ok: true, status: 200, json: async () => ({ screen, suggestion: "", quickCommands: [] }) }) as Response;
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) }) as Response;
const flush = async () => {
  await Promise.resolve();
  await nextTick();
};

describe("useTerminalSnapshots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("polls only as viewer, only visible sessions, without duplicate requests and with concurrency capped", async () => {
    const viewer = ref(false);
    const visibleSessionIds = ref(ids);
    const pending: (() => void)[] = [];
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(() => resolve(ok(`screen-${pending.length}`)));
        }),
    );
    const wrapper = mount(
      defineComponent({
        setup() {
          return useTerminalSnapshots({ viewer, visibleSessionIds, fetcher });
        },
        template: "<div />",
      }),
    );
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
    expect(wrapper.vm.pollMs).toBe(1500);
    expect(wrapper.vm.maxConcurrent).toBe(3);

    viewer.value = true;
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);

    wrapper.vm.request(ids);
    expect(fetcher).toHaveBeenCalledTimes(3);

    pending.shift()?.();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(4);

    viewer.value = false;
    vi.advanceTimersByTime(1500);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(4);

    wrapper.unmount();
  });

  it("uses the default fetch without losing Window as the receiver", async () => {
    const viewer = ref(true);
    const visibleSessionIds = ref([ids[0]]);
    const fetcher = vi.fn(function receiverCheckedFetch(this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(ok("native"));
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      const wrapper = mount(
        defineComponent({
          setup() {
            return useTerminalSnapshots({ viewer, visibleSessionIds });
          },
          template: "<div />",
        }),
      );
      await flush();
      expect(fetcher).toHaveBeenCalledWith(`/api/terminal-sessions/${encodeURIComponent(ids[0])}/screen`, undefined);
      expect(wrapper.vm.snapshots.get(ids[0])?.screen).toBe("native");
      wrapper.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stops while hidden, refreshes on visible, keeps stale screen on transient errors, and reports 404", async () => {
    const viewer = ref(true);
    const visibleSessionIds = ref([ids[0]]);
    const missing = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok("first"))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as Response)
      .mockResolvedValueOnce(notFound());
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const wrapper = mount(
      defineComponent({
        setup() {
          return useTerminalSnapshots({ viewer, visibleSessionIds, fetcher, onMissingSession: missing });
        },
        template: "<div />",
      }),
    );
    await flush();
    expect(wrapper.vm.snapshots.get(ids[0])?.screen).toBe("first");

    vi.advanceTimersByTime(1500);
    await flush();
    expect(wrapper.vm.snapshots.get(ids[0])?.screen).toBe("first");
    expect(wrapper.vm.snapshots.get(ids[0])?.stale).toBe(true);

    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(1500);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);

    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(missing).toHaveBeenCalledWith(ids[0]);
    expect(wrapper.vm.snapshots.get(ids[0])?.notFound).toBe(true);

    wrapper.unmount();
  });
});
