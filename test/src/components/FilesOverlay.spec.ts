import { defineComponent, h } from "vue";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilesOverlay from "../../../src/components/FilesOverlay.vue";

const hoisted = vi.hoisted(() => ({
  setCwd: (() => {}) as (v: string | null) => void,
  setOpen: (() => {}) as (v: boolean) => void,
  setRequestedPath: (() => {}) as (v: string | null) => void,
  reloadSpy: vi.fn(),
}));

vi.mock("../../../src/composables/useFilesView", async () => {
  const { ref } = await import("vue");
  const cwd = ref<string | null>("/proj");
  const isOpen = ref(true);
  const requestedPath = ref<string | null>(null);
  hoisted.setCwd = (v) => (cwd.value = v);
  hoisted.setOpen = (v) => (isOpen.value = v);
  hoisted.setRequestedPath = (v) => (requestedPath.value = v);
  return { useFilesView: () => ({ isOpen, cwd, requestedPath, close: () => (isOpen.value = false) }) };
});

vi.mock("../../../src/components/FilesPane.vue", () => ({
  default: defineComponent({
    name: "FilesPane",
    props: { cwd: { type: String, default: null }, requestedPath: { type: String, default: null } },
    emits: ["close"],
    setup(_props, { emit, expose, slots }) {
      expose({ reload: hoisted.reloadSpy });
      return () => h("div", { "data-testid": "files-pane" }, [slots.title?.(), h("button", { type: "button", onClick: () => emit("close") }, "close")]);
    },
  }),
}));

describe("FilesOverlay", () => {
  beforeEach(() => {
    hoisted.setCwd("/proj");
    hoisted.setRequestedPath(null);
    hoisted.setOpen(true);
    hoisted.reloadSpy.mockClear();
  });

  it("renders the full-screen Files pane for the routed cwd", async () => {
    const w = mount(FilesOverlay);
    await flushPromises();

    expect(w.find('[aria-label="Files"]').exists()).toBe(true);
    expect(w.findComponent({ name: "FilesPane" }).props("cwd")).toBe("/proj");
    expect(w.text()).toContain("Files");
    expect(w.text()).toContain("/proj");
  });

  it("closes through useFilesView when the pane asks to close", async () => {
    const w = mount(FilesOverlay);
    await flushPromises();

    await w.find("button").trigger("click");
    await flushPromises();

    expect(w.find('[aria-label="Files"]').exists()).toBe(false);
  });

  it("updates the pane root and asks it to reload when cwd changes while open", async () => {
    const w = mount(FilesOverlay);
    await flushPromises();

    hoisted.setCwd("/other-project");
    await flushPromises();

    expect(w.findComponent({ name: "FilesPane" }).props("cwd")).toBe("/other-project");
    expect(hoisted.reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("passes a clicked terminal file path through to the pane", async () => {
    const w = mount(FilesOverlay);
    await flushPromises();

    hoisted.setRequestedPath("src/app.ts");
    await flushPromises();

    expect(w.findComponent({ name: "FilesPane" }).props("requestedPath")).toBe("src/app.ts");
  });

  it("does not mount the pane when the route is closed", async () => {
    hoisted.setOpen(false);
    const w = mount(FilesOverlay);
    await flushPromises();

    expect(w.findComponent({ name: "FilesPane" }).exists()).toBe(false);
  });
});
