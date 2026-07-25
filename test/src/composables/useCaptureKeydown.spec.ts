import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useCaptureKeydown } from "../../../src/composables/useCaptureKeydown.js";

const Child = defineComponent({
  props: { handler: { type: Function, required: true } },
  setup(props) {
    useCaptureKeydown(props.handler as (e: KeyboardEvent) => void);
    return () => h("div");
  },
});

// Mirrors App.vue: the grid is cached by <KeepAlive> and toggled by route, so leaving it
// DEACTIVATES rather than unmounts.
function mountCached(handler: (e: KeyboardEvent) => void) {
  const shown = ref(true);
  const wrapper = mount(
    defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (shown.value ? h(Child, { handler }) : null) }),
    }),
  );
  return { wrapper, shown };
}

const press = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));

describe("useCaptureKeydown", () => {
  it("listens once mounted", () => {
    const handler = vi.fn();
    mountCached(handler);
    press();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("STOPS listening while deactivated — a cached view must not swallow keys in another view", async () => {
    const handler = vi.fn();
    const { shown } = mountCached(handler);
    shown.value = false;
    await nextTick();
    press();
    expect(handler).not.toHaveBeenCalled();
  });

  it("listens again after re-activation, exactly once", async () => {
    const handler = vi.fn();
    const { shown } = mountCached(handler);
    shown.value = false;
    await nextTick();
    shown.value = true;
    await nextTick();
    press();
    // Not twice: onMounted and onActivated both attach on first mount, and re-activation
    // attaches again — all of which must collapse to a single registration.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("stops listening after a real unmount", async () => {
    const handler = vi.fn();
    const { wrapper } = mountCached(handler);
    wrapper.unmount();
    await nextTick();
    press();
    expect(handler).not.toHaveBeenCalled();
  });

  it("works for a component that is NOT under KeepAlive (onActivated never fires there)", () => {
    const handler = vi.fn();
    mount(Child, { props: { handler } });
    press();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
