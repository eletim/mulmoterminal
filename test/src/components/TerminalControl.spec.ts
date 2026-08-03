import { computed, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizeTerminalControlLabel,
  type TerminalControlError,
  type TerminalControlOwnerView,
  type TerminalControlState,
} from "../../../common/terminalControl.js";
import TerminalControl from "../../../src/components/TerminalControl.vue";
import type { TerminalControlClient, TerminalControlConnectionStatus } from "../../../src/composables/useTerminalControl.js";

const CLIENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const INSTANCE_ID = "123e4567-e89b-42d3-a456-426614174001";

const terminalControlMocks = vi.hoisted(() => ({
  useTerminalControl: vi.fn(),
}));

vi.mock("../../../src/composables/useTerminalControl", () => ({
  useTerminalControl: terminalControlMocks.useTerminalControl,
}));

interface ControlFixtureOptions {
  status?: TerminalControlConnectionStatus;
  state?: TerminalControlState | null;
  label?: string;
  error?: TerminalControlError | null;
}

function controlFixture(options: ControlFixtureOptions = {}): TerminalControlClient {
  const connectionStatus = ref<TerminalControlConnectionStatus>(options.status ?? "connected");
  const state: Ref<TerminalControlState | null> = ref(options.state ?? { revision: 1, serverTime: 2, owner: null, isOwner: false });
  const error = ref<TerminalControlError | null>(options.error ?? null);
  const label = ref(options.label ?? "This laptop");
  const isOwner = computed(() => connectionStatus.value === "connected" && state.value?.isOwner === true);
  const owner = computed<TerminalControlOwnerView | null>(() => state.value?.owner ?? null);
  const acquire = vi.fn();
  const release = vi.fn();
  const setLabel = vi.fn((nextLabel: string) => {
    label.value = normalizeTerminalControlLabel(nextLabel);
    return label.value;
  });
  return {
    connectionStatus,
    state,
    isOwner,
    owner,
    error,
    clientId: CLIENT_ID,
    instanceId: INSTANCE_ID,
    label,
    ready: computed(() => connectionStatus.value === "connected" && state.value !== null),
    ownerLabel: computed(() => owner.value?.label ?? null),
    ownerConnected: computed(() => owner.value?.connected === true),
    leaseExpiresAt: computed(() => owner.value?.leaseExpiresAt ?? null),
    acquire,
    release,
    setLabel,
  };
}

async function mountOpen(control: TerminalControlClient) {
  terminalControlMocks.useTerminalControl.mockReturnValue(control);
  const wrapper = mount(TerminalControl, { attachTo: document.body });
  await wrapper.find("button[aria-label='Terminal control']").trigger("click");
  return wrapper;
}

function buttonWithText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((button) => button.text().includes(text));
}

describe("TerminalControl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    terminalControlMocks.useTerminalControl.mockReset();
  });

  it("shows the owner state for this tab", async () => {
    const control = controlFixture({
      state: { revision: 1, serverTime: 2, owner: { label: "This laptop", connected: true, leaseExpiresAt: null }, isOwner: true },
    });
    expect((await mountOpen(control)).text()).toContain("This tab has control");
  });

  it("shows the connected owner label for a viewer", async () => {
    const control = controlFixture({
      state: { revision: 1, serverTime: 2, owner: { label: "Development PC", connected: true, leaseExpiresAt: null }, isOwner: false },
    });
    expect((await mountOpen(control)).text()).toContain("Development PC has control");
  });

  it("shows take control when there is no owner", async () => {
    const wrapper = await mountOpen(controlFixture({ state: { revision: 1, serverTime: 2, owner: null, isOwner: false } }));
    expect(wrapper.text()).toContain("No tab currently has control");
    expect(buttonWithText(wrapper, "Take control")?.exists()).toBe(true);
  });

  it("confirms before taking control from another owner", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const control = controlFixture({
      state: { revision: 1, serverTime: 2, owner: { label: "Development PC", connected: true, leaseExpiresAt: null }, isOwner: false },
    });
    const wrapper = await mountOpen(control);
    await buttonWithText(wrapper, "Take control")?.trigger("click");
    expect(confirm).toHaveBeenCalledWith('Take control from "Development PC"?\nTheir terminal will become view-only.');
    expect(control.acquire).toHaveBeenCalledTimes(1);
  });

  it("does not acquire when takeover confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const control = controlFixture({
      state: { revision: 1, serverTime: 2, owner: { label: "Development PC", connected: true, leaseExpiresAt: null }, isOwner: false },
    });
    const wrapper = await mountOpen(control);
    await buttonWithText(wrapper, "Take control")?.trigger("click");
    expect(control.acquire).not.toHaveBeenCalled();
  });

  it("does not confirm when taking control with no owner", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const control = controlFixture({ state: { revision: 1, serverTime: 2, owner: null, isOwner: false } });
    const wrapper = await mountOpen(control);
    await buttonWithText(wrapper, "Take control")?.trigger("click");
    expect(confirm).not.toHaveBeenCalled();
    expect(control.acquire).toHaveBeenCalledTimes(1);
  });

  it("calls release from the owner state", async () => {
    const control = controlFixture({
      state: { revision: 1, serverTime: 2, owner: { label: "This laptop", connected: true, leaseExpiresAt: null }, isOwner: true },
    });
    const wrapper = await mountOpen(control);
    await buttonWithText(wrapper, "Release control")?.trigger("click");
    expect(control.release).toHaveBeenCalledTimes(1);
  });

  it("disables operation buttons while disconnected", async () => {
    const wrapper = await mountOpen(controlFixture({ status: "disconnected", state: null, error: { code: "connect_error", message: "offline" } }));
    const take = buttonWithText(wrapper, "Take control");
    expect(wrapper.text()).toContain("Terminal control connection lost");
    expect(take?.attributes("disabled")).toBeDefined();
  });

  it("saves edited labels only through setLabel", async () => {
    const control = controlFixture();
    const wrapper = await mountOpen(control);
    await wrapper.find("input#terminal-control-label").setValue("  Tablet  ");
    expect(control.setLabel).not.toHaveBeenCalled();
    await wrapper.find("form").trigger("submit");
    expect(control.setLabel).toHaveBeenCalledWith("  Tablet  ");
  });
});
