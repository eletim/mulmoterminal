import { describe, it, expect, vi, afterEach } from "vitest";
import { registerRemoteHostSelfHeal } from "../../../src/components/remoteHostSelfHeal.js";

describe("registerRemoteHostSelfHeal", () => {
  it("heals on socket reconnect, window online, and return-to-visible; cleanup stops all", () => {
    const heal = vi.fn();
    const unsubscribe = vi.fn();
    const registered: Array<() => void> = [];
    const onReconnect = (cb: () => void) => {
      registered.push(cb);
      return unsubscribe;
    };

    const stop = registerRemoteHostSelfHeal(heal, onReconnect);
    expect(registered).toHaveLength(1);

    registered[0]?.(); // server came back
    window.dispatchEvent(new Event("online")); // network restored
    document.dispatchEvent(new Event("visibilitychange")); // visible (jsdom default)
    expect(heal).toHaveBeenCalledTimes(3);

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1); // socket reconnect listener removed
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(heal).toHaveBeenCalledTimes(3); // DOM listeners removed too
  });

  it("does NOT heal when a visibilitychange fires while the tab is going hidden", () => {
    const heal = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });

    const stop = registerRemoteHostSelfHeal(heal, () => () => undefined);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(heal).not.toHaveBeenCalled();

    stop();
    if (original) Object.defineProperty(document, "visibilityState", original);
  });

  // Without a tick, a tab left open and visible keeps whatever status it fetched on mount:
  // the channel can die and the toolbar goes on showing "connected" (#823).
  describe("periodic heal", () => {
    afterEach(() => vi.useRealTimers());

    it("heals on a timer while nothing else fires", () => {
      vi.useFakeTimers();
      const heal = vi.fn();
      const stop = registerRemoteHostSelfHeal(heal, () => () => undefined, 30_000);

      expect(heal).not.toHaveBeenCalled(); // the caller heals once itself; the tick is extra
      vi.advanceTimersByTime(29_999);
      expect(heal).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(heal).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60_000);
      expect(heal).toHaveBeenCalledTimes(3); // keeps ticking, not a one-shot
      stop();
    });

    it("stops ticking after cleanup", () => {
      vi.useFakeTimers();
      const heal = vi.fn();
      const stop = registerRemoteHostSelfHeal(heal, () => () => undefined, 30_000);
      stop();
      vi.advanceTimersByTime(300_000);
      expect(heal).not.toHaveBeenCalled();
    });
  });
});
