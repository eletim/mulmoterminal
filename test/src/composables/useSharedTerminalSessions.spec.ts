import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pubsub = vi.hoisted(() => ({
  handlers: new Map<string, (data: unknown) => void>(),
  reconnect: [] as (() => void)[],
}));

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, cb: (data: unknown) => void) => {
      pubsub.handlers.set(channel, cb);
      return () => pubsub.handlers.delete(channel);
    },
    onReconnect: (cb: () => void) => {
      pubsub.reconnect.push(cb);
      return () => {
        const idx = pubsub.reconnect.indexOf(cb);
        if (idx >= 0) pubsub.reconnect.splice(idx, 1);
      };
    },
  }),
}));

const { useSharedTerminalSessions } = await import("../../../src/composables/useSharedTerminalSessions");

const ID = "123e4567-e89b-12d3-a456-426614174000";
const row = { id: ID, title: "one", cwd: "/repo", live: true, agent: "shell", resume: { kind: "launcher", shell: true } };
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const fail = () => ({ ok: false, status: 500, json: async () => ({}) }) as Response;
const flush = async () => {
  await Promise.resolve();
  await nextTick();
};

describe("useSharedTerminalSessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pubsub.handlers.clear();
    pubsub.reconnect.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads a valid roster, rejects invalid responses without clearing the last good list, and refreshes from debounced events", async () => {
    const fetcher = vi.fn(async () => ok({ sessions: [row] }));
    const wrapper = mount(
      defineComponent({
        setup() {
          return useSharedTerminalSessions(fetcher);
        },
        template: "<div />",
      }),
    );
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.list).toEqual([row]);

    fetcher.mockImplementationOnce(async () => ok({ sessions: [{ ...row, id: "bad" }] }));
    await wrapper.vm.refresh();
    expect(wrapper.vm.list).toEqual([row]);
    expect(wrapper.vm.error).toBe("Invalid terminal session response");

    fetcher.mockImplementation(async () => ok({ sessions: [{ ...row, title: "two" }] }));
    pubsub.handlers.get("sessions")?.({ id: "unknown", working: true });
    pubsub.handlers.get("sessions")?.({ event: "created", id: ID });
    vi.advanceTimersByTime(249);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(wrapper.vm.list[0].title).toBe("two");

    pubsub.handlers.get("sessions")?.({ id: ID, working: true });
    vi.advanceTimersByTime(300);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);

    pubsub.reconnect[0]?.();
    vi.advanceTimersByTime(250);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(4);

    fetcher.mockImplementationOnce(async () => fail());
    vi.advanceTimersByTime(30_000);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(wrapper.vm.list[0].title).toBe("two");
    wrapper.unmount();
  });
});
