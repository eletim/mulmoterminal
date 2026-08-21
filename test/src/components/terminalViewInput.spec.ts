// The wire between two halves that were each already covered and still left the middle untested:
// useTerminalConnections decides WHAT counts as the user typing, TerminalCell decides what to do
// about it, and this component is the only thing joining them. Deleting the join used to leave
// every one of the ~6.8k specs passing while a parked cell could never be woken again (#992).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import type { ConnHandlers } from "../../../src/composables/useTerminalConnections";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

const attachedHandlers: ConnHandlers[] = [];
vi.mock("../../../src/composables/useTerminalConnections", async () => {
  const { reactive } = await import("vue");
  return {
    connView: reactive(new Map()),
    attach: (_k: string, _t: unknown, handlers: ConnHandlers) => attachedHandlers.push(handlers),
    setFont: () => {},
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

// jsdom has no ResizeObserver and Terminal.vue constructs one on mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// At module scope, not inside a test: a component's module load is not the test's work, and
// billing it to `testTimeout` is what makes the first test of a file the one that flakes.
const Terminal = (await import("../../../src/components/Terminal.vue")).default;
const terminalConn = await import("../../../src/composables/useTerminalConnections");

const mountTerminal = async (props: Record<string, unknown> = {}) => {
  return mount(Terminal, { props: { sessionId: null, connectKey: 1, persistKey: "input-spec", cwd: "/proj/input-spec", ...props } });
};

// The compiled SFC lists the names `defineEmits` declared. Read through a guard rather than a
// cast, since the component object is typed as a component and not as this shape.
const declaredEmits = (component: unknown): string[] => {
  if (component && typeof component === "object" && "emits" in component && Array.isArray(component.emits)) {
    return component.emits.filter((name): name is string => typeof name === "string");
  }
  return [];
};

beforeEach(() => {
  attachedHandlers.length = 0;
  terminalConn.connView.clear();
  document.body.innerHTML = "";
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
});

describe("Terminal.vue reports the user typing", () => {
  it("binds onInput when it attaches, so the connection has somewhere to report to", async () => {
    await mountTerminal();
    await flushPromises();
    expect(attachedHandlers[0]?.onInput).toBeTypeOf("function");
  });

  it("raises an `input` event when the connection reports one", async () => {
    const w = await mountTerminal();
    await flushPromises();
    attachedHandlers[0]?.onInput?.();
    expect(w.emitted("input")).toHaveLength(1);
  });

  // DECLARING `input` is load-bearing, not bookkeeping. xterm keeps a hidden <textarea> that
  // fires a NATIVE `input` event on every keystroke and all through IME composition, and it
  // bubbles to this component's root. A declared emit is excluded from fallthrough, so a parent's
  // `@input` binds to the component event alone. Drop the declaration and that same `@input`
  // silently becomes a native listener — firing on composition and bypassing the pointer/focus
  // filtering in terminalUserInput entirely, which is the whole reason the event exists.
  it("declares `input` as a component emit, which is what shadows the native one", async () => {
    expect(declaredEmits(Terminal)).toContain("input");
  });

  it("shows the Shell last-command copy button disabled before a command is available", async () => {
    const w = await mountTerminal({ launcher: { shell: true } });
    await flushPromises();
    const button = w.get('[data-testid="desktop-shell-copy-last-command"]');

    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("title")).toBe("Run a command to enable copy");
  });

  it("does not show the Shell last-command copy button for non-Shell terminals", async () => {
    const w = await mountTerminal();
    await flushPromises();
    expect(w.find('[data-testid="desktop-shell-copy-last-command"]').exists()).toBe(false);
  });

  it("copies the Shell last command and shows copied feedback", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    terminalConn.connView.set("input-spec", { status: "connected", serverCwd: "/proj/input-spec", lastCommandCopyText: "$ pwd\n/proj/input-spec" });
    const w = await mountTerminal({ launcher: { shell: true } });
    await flushPromises();

    await w.get('[data-testid="desktop-shell-copy-last-command"]').trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("$ pwd\n/proj/input-spec");
    expect(w.text()).toContain("Copied");
  });

  it("shows selected manual copy fallback when Shell last-command clipboard write fails", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    terminalConn.connView.set("input-spec", { status: "connected", serverCwd: "/proj/input-spec", lastCommandCopyText: "$ pwd\n/proj/input-spec" });
    const w = await mountTerminal({ launcher: { shell: true } });
    await flushPromises();

    await w.get('[data-testid="desktop-shell-copy-last-command"]').trigger("click");
    await flushPromises();

    const box = document.body.querySelector('[data-testid="desktop-shell-last-command-manual-copy"]');
    if (!(box instanceof HTMLTextAreaElement)) throw new Error("manual copy textarea not found");
    expect(box.value).toBe("$ pwd\n/proj/input-spec");
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe("$ pwd\n/proj/input-spec".length);
  });
});
