import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import type { TerminalFont } from "../../../src/composables/useTerminalConnections";
import { TERMINAL_FONT_FAMILY_DEFAULT } from "../../../common/terminalFontFamily";
import { TERMINAL_FONT_SIZE_DEFAULT } from "../../../common/terminalFontSize";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

// The seam under test. attach() takes the font the terminal is BUILT with; setFont() is the
// only path that changes it afterwards — and the only one that re-fits and tells the PTY.
const attached: TerminalFont[] = [];
const setFontCalls: TerminalFont[] = [];
vi.mock("../../../src/composables/useTerminalConnections", async () => {
  const { reactive: r } = await import("vue");
  return {
    connView: r(new Map()),
    attach: (_k: string, _t: unknown, _h: unknown, _el: unknown, _theme: unknown, font: TerminalFont) => attached.push(font),
    setFont: (_k: string, font: TerminalFont) => setFontCalls.push(font),
    setTheme: () => {},
    detach: () => {},
    release: () => {},
    retarget: () => {},
    terminate: () => {},
    fit: () => {},
    focus: () => {},
    insertText: () => {},
    sendView: () => {},
    readBuffer: () => null,
    submitText: () => true,
    isClaudeTarget: () => false,
  };
});

// jsdom has no ResizeObserver, and Terminal.vue constructs one on mount. The auto-fit it drives
// is not what these specs are about — the font seam is — so a no-op stub is enough.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  attached.length = 0;
  setFontCalls.length = 0;
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
});

async function mountTerminal(slot: string, dirFontFamily: string | null, dirFontSize: number | null) {
  const Terminal = (await import("../../../src/components/Terminal.vue")).default;
  return mount(Terminal, {
    props: { sessionId: null, connectKey: 1, persistKey: slot, cwd: `/proj/${slot}`, dirFontFamily, dirFontSize },
  });
}

describe("Terminal.vue applies the resolved font", () => {
  it("builds the terminal with the dir-pinned family when it is known at mount", async () => {
    await mountTerminal("pinned", "Songti SC, monospace", 20);
    await flushPromises();
    expect(attached[0]).toEqual({ size: 20, family: "Songti SC, monospace" });
  });

  it("falls back to the built-in stack when the directory pins nothing", async () => {
    await mountTerminal("plain", null, null);
    await flushPromises();
    expect(attached[0]).toEqual({ size: TERMINAL_FONT_SIZE_DEFAULT, family: TERMINAL_FONT_FAMILY_DEFAULT });
  });

  // The load-bearing case. useDirConfig has nothing cached on a fresh page load, so the terminal
  // is BUILT with the default and the directory's font arrives only when /api/dir-config
  // resolves. If this watcher does not fire, a dir-pinned font never applies at all — which is
  // indistinguishable, from the user's side, from the feature not working.
  it("applies a family that arrives AFTER mount, via setFont so it re-fits", async () => {
    const w = await mountTerminal("late", null, null);
    await flushPromises();
    expect(setFontCalls).toHaveLength(0);

    await w.setProps({ dirFontFamily: "Songti SC, monospace" });
    await flushPromises();

    expect(setFontCalls).toHaveLength(1);
    expect(setFontCalls[0].family).toBe("Songti SC, monospace");
  });
});
