import { beforeEach, describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import LauncherCell from "../../../src/components/LauncherCell.vue";

let releaseConnection = vi.fn();
let setInputEnabled = vi.fn();

// Stub the terminal so no xterm/WebSocket is needed; it just forwards the props the
// cell passes and can emit session/exit.
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["persistKey", "sessionId", "connectKey", "cwd", "launcher", "metadataActive"],
    emits: ["session", "exit"],
    template: '<div class="stub-term" />',
    methods: {
      releaseConnection() {
        releaseConnection();
      },
      setInputEnabled(enabled: boolean) {
        setInputEnabled(enabled);
      },
    },
  },
}));

const ID = "77777777-7777-4777-8777-777777777777";
const LAUNCHER = { index: 1, label: "zsh" };
const baseProps = { uid: 7, active: false, expanded: false, launcher: LAUNCHER, session: ID, cwd: "/work/proj", home: "/work" };
const mountCell = (extra: Record<string, unknown> = {}) => mount(LauncherCell, { props: { ...baseProps, ...extra } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

beforeEach(() => {
  releaseConnection = vi.fn();
  setInputEnabled = vi.fn();
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ deleted: true }) })) as unknown as typeof fetch;
});

describe("LauncherCell header zoom", () => {
  // #965: the whole cell — header included — sits in one wrapper, so the focus zoom can be
  // cancelled about the cell's own centre. A second element child, or content left outside the
  // wrapper, would scale with the frame and resample the terminal's canvas.
  it("keeps its whole content in the focus-zoom wrapper", () => {
    const root = mountCell().element;
    expect(root.children).toHaveLength(1);
    expect(root.children[0].className).toContain("group-[.focused]/cell:scale-[calc(1/var(--focus-zoom))]");
  });

  it("shows the label + dir and runs the configured launcher in its directory", () => {
    const w = mountCell({ active: true });
    expect(w.find(".cell-cmd").text()).toContain("zsh");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.props("launcher")).toEqual({ index: 1 });
    expect(term.props("cwd")).toBe("/work/proj");
    expect(term.props("metadataActive")).toBe(true);
  });

  it("routes configured persistent launcher close through confirmed Core Delete", async () => {
    const w = mountCell();
    await w.find('[aria-label="Expand terminal"]').trigger("click");
    await w.find('[aria-label="Close terminal"]').trigger("click");
    await flushPromises();
    expect(w.emitted("toggle-expand")).toHaveLength(1);
    expect(w.emitted("close")).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith(`/api/session/${ID}`, { method: "DELETE" });
    expect(releaseConnection).toHaveBeenCalledOnce();
  });

  it.each([
    ["running Shell", false],
    ["exited/dead Shell", true],
  ])("keeps a %s cell until the same Delete succeeds", async (_label, exited) => {
    const gate = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    globalThis.fetch = vi.fn(() => gate.promise) as unknown as typeof fetch;
    const w = mountCell({ launcher: { shell: true, label: "shell" } });
    if (exited) await w.findComponent({ name: "TerminalView" }).vm.$emit("exit", 130);

    await w.find('[aria-label="Close terminal"]').trigger("click");
    await w.find('[aria-label="Close terminal"]').trigger("click");

    expect(w.find('[data-testid="cell-deleting"]').exists()).toBe(true);
    expect(w.emitted("close")).toBeUndefined();
    expect(releaseConnection).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    gate.resolve({ ok: true, json: async () => ({ deleted: true }) });
    await flushPromises();
    expect(w.emitted("close")).toHaveLength(1);
    expect(releaseConnection).toHaveBeenCalledOnce();
  });

  it("keeps a failed Shell Delete visible, clears pending, and retries", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Core unavailable" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ deleted: true }) }) as unknown as typeof fetch;
    const w = mountCell({ launcher: { shell: true, label: "shell" } });

    await w.find('[aria-label="Close terminal"]').trigger("click");
    await flushPromises();
    expect(w.emitted("close")).toBeUndefined();
    expect(releaseConnection).not.toHaveBeenCalled();
    expect(w.find('[data-testid="cell-deleting"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-delete-error"]').text()).toContain("Core unavailable");
    expect(setInputEnabled.mock.calls).toEqual([[false], [true]]);

    await w.find('[aria-label="Close terminal"]').trigger("click");
    await flushPromises();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("waits for a fresh launch session id before issuing exactly one Delete", async () => {
    const w = mountCell({ session: null });
    await w.find('[aria-label="Close terminal"]').trigger("click");
    await w.find('[aria-label="Close terminal"]').trigger("click");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(w.emitted("close")).toBeUndefined();

    await w.findComponent({ name: "TerminalView" }).vm.$emit("session", ID);
    await flushPromises();
    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith(`/api/session/${ID}`, { method: "DELETE" });
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("zooms on a header-background click in the normal grid (mirrors clicking the body)", async () => {
    const w = mountCell(); // expanded: false, zoomed: undefined → tiled grid
    expect(w.find(".cell-header").classes()).toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("zooms on a header-background click when it's a filmstrip thumbnail", async () => {
    const w = mountCell({ zoomed: true }); // some other cell is zoomed → this is a thumbnail
    expect(w.find(".cell-header").classes()).toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("does not zoom on a header-background click while expanded (restore via the ⤡ button)", async () => {
    const w = mountCell({ expanded: true });
    expect(w.find(".cell-header").classes()).not.toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toBeUndefined();
  });
});
