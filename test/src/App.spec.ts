import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import App from "../../src/App.vue";
import { router } from "../../src/router/index";

// App.vue mounts exactly one of the two page shells, picked by route name alone (never
// both, never neither) — the mobile page must never drag the desktop grid, its overlays,
// or the launch-terminal subscription along with it.
const settle = () => flushPromises();

const mountAt = async (path: string) => {
  await router.push(path);
  await settle();
  const wrapper = mount(App, { global: { plugins: [router], stubs: { DesktopAppShell: true, MobileTerminalPage: true } } });
  await settle();
  return wrapper;
};

describe("App page split", () => {
  beforeEach(async () => {
    await router.push("/terminals");
    await settle();
  });

  it("mounts only DesktopAppShell on /terminals", async () => {
    const wrapper = await mountAt("/terminals");
    expect(wrapper.findComponent({ name: "DesktopAppShell" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "MobileTerminalPage" }).exists()).toBe(false);
  });

  it("mounts only MobileTerminalPage on /mobile/terminals", async () => {
    const wrapper = await mountAt("/mobile/terminals");
    expect(wrapper.findComponent({ name: "MobileTerminalPage" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "DesktopAppShell" }).exists()).toBe(false);
  });

  it("keeps the desktop toolbar out of the short mobile entry", async () => {
    const wrapper = await mountAt("/mobile");
    expect(wrapper.findComponent({ name: "MobileTerminalPage" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "DesktopAppShell" }).exists()).toBe(false);
  });
});
