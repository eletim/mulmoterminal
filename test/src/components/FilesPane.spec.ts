import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilesPane from "../../../src/components/FilesPane.vue";

// Don't instantiate real CodeMirror (needs a full DOM); capture the change callback so a
// user edit can be simulated.
let onChange: () => void = () => {};
const fakeEditor = { setDoc: vi.fn(), getDoc: vi.fn(() => "edited text"), destroy: vi.fn() };
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: (_host: HTMLElement, cb: () => void) => ((onChange = cb), fakeEditor) };
});

function mockFs() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/list")) return { ok: true, json: async () => ({ entries: [{ name: "README.md", dir: false, size: 10 }] }) };
    if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
    return { ok: true, json: async () => ({ ok: true, version: "v2" }), _init: init };
  }) as unknown as typeof fetch;
}

const writeCalls = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("/write"));

async function openFileAndEdit(cwd: string | null = "/proj") {
  const w = mount(FilesPane, { props: { cwd } });
  await flushPromises();
  await w.findAll('[data-testid="files-row"]')[0].trigger("click");
  await flushPromises();
  onChange();
  await flushPromises();
  return w;
}

describe("FilesPane", () => {
  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    mockFs();
  });

  // The pane beside a zoomed grid cell has no route, no ?cwd= and no "is it open" — it is
  // handed a directory and mounted. That the overlay ALSO uses it is covered by its own spec.
  it("browses and opens a file from nothing but a cwd prop", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    expect(w.text()).toContain("README.md");

    await w.findAll('[data-testid="files-row"]')[0].trigger("click");
    await flushPromises();
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "README.md");
    const read = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).includes("/text"));
    expect(String(read?.[0])).toContain(encodeURIComponent("/proj"));
  });

  // The host guards its own navigation on this; a missed event means it guards on a stale answer.
  it("reports the buffer going dirty, and clean again after a save", async () => {
    const w = await openFileAndEdit();
    expect(w.emitted("dirty")?.at(-1)).toEqual([true]);

    await w
      .findAll("button")
      .find((b) => b.text().startsWith("Save"))
      ?.trigger("click");
    await flushPromises();
    expect(w.emitted("dirty")?.at(-1)).toEqual([false]);
  });

  // Bound to the pane's own subtree, not to window: with a pane open beside a terminal, a
  // window-level handler would save whenever the user pressed ⌘S while typing INTO the terminal.
  it("saves on ⌘S inside the pane, and ignores one raised outside it", async () => {
    const w = await openFileAndEdit();
    expect(writeCalls()).toHaveLength(0);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }));
    await flushPromises();
    expect(writeCalls()).toHaveLength(0);

    await w.trigger("keydown", { key: "s", metaKey: true });
    await flushPromises();
    expect(writeCalls()).toHaveLength(1);
  });

  it("asks before closing on top of unsaved edits, and stays put when refused", async () => {
    const w = await openFileAndEdit();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await w.find('[aria-label="Close files"]').trigger("click");
    expect(confirmSpy).toHaveBeenCalled();
    expect(w.emitted("close")).toBeUndefined();

    confirmSpy.mockReturnValue(true);
    await w.find('[aria-label="Close files"]').trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
    confirmSpy.mockRestore();
  });

  // reload() is how the host says "the root changed and I already cleared it with the user" —
  // the pane never reacts to `cwd` itself, or it would discard a buffer still being asked about.
  it("re-reads the tree only when the host calls reload, not when cwd changes", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    const listCalls = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("/list"));
    expect(listCalls()).toHaveLength(1);

    await w.setProps({ cwd: "/other" });
    await flushPromises();
    expect(listCalls()).toHaveLength(1);

    await (w.vm as unknown as { reload: () => Promise<void> }).reload();
    await flushPromises();
    expect(listCalls()).toHaveLength(2);
    expect(String(listCalls()[1][0])).toContain(encodeURIComponent("/other"));
  });
});
