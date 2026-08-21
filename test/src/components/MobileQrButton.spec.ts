import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import MobileQrButton from "../../../src/components/MobileQrButton.vue";

const { toCanvas } = vi.hoisted(() => ({ toCanvas: vi.fn() }));

vi.mock("qrcode", () => ({ toCanvas }));

function installClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("MobileQrButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toCanvas.mockReset();
    toCanvas.mockImplementation((canvas: HTMLCanvasElement, text: string) => {
      canvas.dataset.qrValue = text;
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens and closes a compact QR popover from the toolbar button", async () => {
    const wrapper = mount(MobileQrButton);

    expect(wrapper.find('[data-testid="mobile-qr-url"]').exists()).toBe(false);
    await wrapper.get('button[aria-label="Mobile QR code"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="mobile-qr-url"]').text()).toBe("http://localhost:3000/mobile");
    expect(wrapper.get('[data-testid="mobile-qr-canvas"]').attributes("data-qr-value")).toBe("http://localhost:3000/mobile");

    await wrapper.get("button[title='Open mobile view']").trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="mobile-qr-url"]').exists()).toBe(false);
  });

  it("copies the displayed URL and shows feedback", async () => {
    const writeText = installClipboard();
    const wrapper = mount(MobileQrButton);

    await wrapper.get('button[aria-label="Mobile QR code"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="mobile-qr-copy"]').trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/mobile");
    expect(wrapper.get('[data-testid="mobile-qr-copy"]').text()).toBe("Copied");

    vi.advanceTimersByTime(1500);
    await flushPromises();
    expect(wrapper.get('[data-testid="mobile-qr-copy"]').text()).toBe("Copy URL");
  });

  it("falls back to manual copy when the Clipboard API is blocked", async () => {
    installClipboard(vi.fn().mockRejectedValue(new Error("blocked")));
    const wrapper = mount(MobileQrButton, { attachTo: document.body });

    await wrapper.get('button[aria-label="Mobile QR code"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="mobile-qr-copy"]').trigger("click");
    await flushPromises();

    const textarea = document.body.querySelector<HTMLTextAreaElement>('[data-testid="mobile-qr-manual-copy"]');
    expect(textarea?.value).toBe("http://localhost:3000/mobile");
  });
});
