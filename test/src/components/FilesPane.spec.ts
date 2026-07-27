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

  // Saving on the way out rather than asking: the editor sits beside a terminal being worked
  // in, and the server keeps three generations of whatever a save replaces.
  it("saves the buffer when closing, without asking", async () => {
    const w = await openFileAndEdit();
    const confirmSpy = vi.spyOn(window, "confirm");

    await w.find('[aria-label="Close files"]').trigger("click");
    await flushPromises();
    expect(writeCalls()).toHaveLength(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(w.emitted("close")).toHaveLength(1);
    confirmSpy.mockRestore();
  });

  it("saves the open file before opening another one", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/list")) {
        return {
          ok: true,
          json: async () => ({
            entries: [
              { name: "README.md", dir: false, size: 10 },
              { name: "other.md", dir: false, size: 10 },
            ],
          }),
        };
      }
      if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
      return { ok: true, json: async () => ({ ok: true, version: "v2" }), _init: init };
    }) as unknown as typeof fetch;

    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    await w.findAll('[data-testid="files-row"]')[0].trigger("click");
    await flushPromises();
    onChange();
    await flushPromises();

    await w.findAll('[data-testid="files-row"]')[1].trigger("click");
    await flushPromises();
    expect(writeCalls()).toHaveLength(1);
    expect(fakeEditor.setDoc).toHaveBeenLastCalledWith("# hello", "other.md");
  });

  // A save can lose the version race on the way out, and there is nowhere to put a banner by
  // then — so the buffer goes to the backup store and the other writer's file is left alone.
  it("banks the buffer instead of a banner when the parting save hits a conflict", async () => {
    const w = await openFileAndEdit();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/backup")) return { ok: true, json: async () => ({ stored: true }) };
      if (url.includes("/write")) return { ok: false, status: 409, json: async () => ({ error: "file changed on disk", version: "v9" }) };
      return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
    }) as unknown as typeof fetch;

    await (w.vm as unknown as { flush: () => Promise<void> }).flush();
    await flushPromises();
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/backup"))).toBe(true);
    expect(w.find('[data-testid="files-conflict"]').exists()).toBe(false);
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

// Leaving happens WHILE the pane is being torn down. Anything flush() reads after its first
// await may already be gone, which is how a parting save's 409 fallback lost the buffer.
describe("FilesPane leaving mid-unmount", () => {
  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    mockFs();
  });

  it("still banks the buffer when the pane unmounts during the parting save", async () => {
    const w = await openFileAndEdit();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/backup")) return { ok: true, json: async () => ({ stored: true }) };
      return { ok: false, status: 409, json: async () => ({ error: "file changed on disk", version: "v9" }) };
    }) as unknown as typeof fetch;

    const flushing = (w.vm as unknown as { flush: () => Promise<void> }).flush();
    w.unmount(); // the editor is destroyed while the write is in flight
    await flushing;
    await flushPromises();

    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/backup"))).toBe(true);
  });

  // Clearing `dirty` on a failed backup would leave the only copy nowhere and say it was fine.
  it("keeps the buffer marked unsaved when neither the save nor the backup lands", async () => {
    const w = await openFileAndEdit();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "nope" }) })) as unknown as typeof fetch;

    await (w.vm as unknown as { flush: () => Promise<void> }).flush();
    await flushPromises();
    expect(w.emitted("dirty")?.at(-1)).toEqual([true]);
  });

  // No awaiting an answer on the way out of the tab, so the backup goes unconditionally.
  it("banks and writes on pagehide, so a conflict there can't cost the buffer", async () => {
    await openFileAndEdit();
    const before = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    window.dispatchEvent(new Event("pagehide"));
    await flushPromises();

    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.slice(before).map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/backup"))).toBe(true);
    expect(calls.some((u) => u.includes("/write"))).toBe(true);
  });
});

// The server being down turns "leave and save" into "leave and lose". Every caller that CAN
// stay has to stay, because at that point the buffer is the only copy in existence.
describe("FilesPane when nothing can be saved or banked", () => {
  const allFail = () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/list"))
        return {
          ok: true,
          json: async () => ({
            entries: [
              { name: "README.md", dir: false, size: 10 },
              { name: "other.md", dir: false, size: 10 },
            ],
          }),
        };
      if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
      return { ok: false, status: 500, json: async () => ({ error: "server is down" }) };
    }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    mockFs();
  });

  it("reports it, and stays unsaved, instead of claiming success", async () => {
    const w = await openFileAndEdit();
    allFail();
    expect(await (w.vm as unknown as { flush: () => Promise<boolean> }).flush()).toBe(false);
    expect(w.emitted("dirty")?.at(-1)).toEqual([true]);
    expect(w.text()).toContain("server is down");
  });

  it("does not open another file over the top of it", async () => {
    allFail(); // reads still work; writes and backups do not
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    await w.findAll('[data-testid="files-row"]')[0].trigger("click");
    await flushPromises();
    onChange();
    await flushPromises();

    fakeEditor.setDoc.mockClear();
    await w.findAll('[data-testid="files-row"]')[1].trigger("click");
    await flushPromises();
    expect(fakeEditor.setDoc).not.toHaveBeenCalled(); // still on the file with the edits
  });

  it("does not close", async () => {
    const w = await openFileAndEdit();
    allFail();
    await w.find('[aria-label="Close files"]').trigger("click");
    await flushPromises();
    expect(w.emitted("close")).toBeUndefined();
  });

  // "Kept as a backup either way" is the banner's promise; a store that refuses the write
  // means the honest move is to keep the buffer rather than discard it anyway.
  it("refuses to discard on the conflict banner when the backup is refused", async () => {
    const w = await openFileAndEdit();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/backup")) return { ok: false, status: 500, json: async () => ({ error: "no room" }) };
      if (url.includes("/write")) return { ok: false, status: 409, json: async () => ({ error: "file changed on disk", version: "v9" }) };
      return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
    }) as unknown as typeof fetch;

    await w
      .findAll("button")
      .find((b) => b.text().startsWith("Save"))
      ?.trigger("click");
    await flushPromises();
    fakeEditor.setDoc.mockClear();

    await w
      .findAll("button")
      .find((b) => b.text().startsWith("Reload"))
      ?.trigger("click");
    await flushPromises();
    expect(fakeEditor.setDoc).not.toHaveBeenCalled(); // the buffer is still there
    expect(w.text()).toContain("could not back up your version");
  });
});
