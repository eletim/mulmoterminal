import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilesOverlay from "../../../src/components/FilesOverlay.vue";

// The view is route-driven; stub useFilesView so the overlay is "open" without a router.
// A shared cwd ref lets a test drive a route-root change; filesGotoIndex mutates it too
// (the component uses it to revert a declined root switch).
const hoisted = vi.hoisted(() => ({
  setCwd: (() => {}) as (v: string | null) => void,
  setOpen: (() => {}) as (v: boolean) => void,
  setRequestedPath: (() => {}) as (v: string | null) => void,
}));
vi.mock("../../../src/composables/useFilesView", async () => {
  const { ref: r } = await import("vue");
  const cwd = r<string | null>("/proj");
  const isOpen = r(true);
  // ?path= — a file the URL asks to open (a clicked source path in terminal output).
  const requestedPath = r<string | null>(null);
  hoisted.setCwd = (v) => (cwd.value = v);
  hoisted.setOpen = (v) => (isOpen.value = v);
  hoisted.setRequestedPath = (v) => (requestedPath.value = v);
  return {
    useFilesView: () => ({ isOpen, cwd, requestedPath, close: () => (isOpen.value = false) }),
    // Revert re-opens /files at the restored root (isOpen back to true).
    filesGotoIndex: (v: string | null) => ((cwd.value = v), (isOpen.value = true)),
    filesGotoFile: (v: string | null, p: string) => ((cwd.value = v), (requestedPath.value = p), (isOpen.value = true)),
  };
});

// Don't instantiate real CodeMirror (needs a full DOM); capture the change callback so
// we can simulate a user edit, and record setDoc/getDoc.
let onChange: () => void = () => {};
const fakeEditor = { setDoc: vi.fn(), getDoc: vi.fn(() => "edited text"), destroy: vi.fn() };
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: (_host: HTMLElement, cb: () => void) => ((onChange = cb), fakeEditor) };
});

function mockFs() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/list")) {
      const p = new URL(url, "https://x").searchParams.get("path");
      const entries =
        p === ""
          ? [
              { name: "src", dir: true, size: 0 },
              { name: "README.md", dir: false, size: 10 },
              { name: "notes.txt", dir: false, size: 4 },
            ]
          : [{ name: "app.ts", dir: false, size: 5 }];
      return { ok: true, json: async () => ({ entries }) };
    }
    if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello" }) };
    if (url.includes("/write")) return { ok: true, json: async () => ({ ok: true }), _init: init };
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

function must<T>(v: T | undefined, msg: string): T {
  if (v === undefined) throw new Error(msg);
  return v;
}

// The mocked cwd ref and fakeEditor are module singletons, so an un-unmounted overlay
// from a prior test would also react to a later test's cwd change. Track and unmount.
const wrappers: ReturnType<typeof mount>[] = [];
const mountOverlay = () => {
  const w = mount(FilesOverlay);
  wrappers.push(w);
  return w;
};

describe("FilesOverlay", () => {
  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    hoisted.setCwd("/proj");
    hoisted.setRequestedPath(null);
    hoisted.setOpen(true);
    mockFs();
  });
  afterEach(() => wrappers.splice(0).forEach((w) => w.unmount()));

  it("loads the root tree, opens a file, edits, and saves", async () => {
    const w = mountOverlay();
    await flushPromises();
    // Root entries rendered (directories first).
    expect(w.text()).toContain("src");
    expect(w.text()).toContain("README.md");

    // Open the markdown file → text fetched and pushed into the editor.
    const readmeRow = must(
      w.findAll('[data-testid="files-row"]').find((b) => b.text().includes("README.md")),
      "README row",
    );
    await readmeRow.trigger("click");
    await flushPromises();
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "README.md");
    expect(w.text()).toContain("Preview"); // md preview toggle offered

    // No unsaved edits yet → Save disabled. Simulate an edit → Save enables.
    const saveBtn = () =>
      must(
        w.findAll("button").find((b) => b.text().startsWith("Save")),
        "save btn",
      );
    expect(saveBtn().attributes("disabled")).toBeDefined();
    onChange();
    await flushPromises();
    expect(saveBtn().attributes("disabled")).toBeUndefined();

    await saveBtn().trigger("click");
    await flushPromises();
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const putCall = must(
      calls.find((c) => String(c[0]).includes("/write")),
      "write call",
    );
    expect(putCall[1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(putCall[1].body)).toEqual({ text: "edited text" });
  });

  it("guards against discarding unsaved edits when switching files", async () => {
    const w = mountOverlay();
    await flushPromises();
    const open = (name: string) =>
      must(
        w.findAll('[data-testid="files-row"]').find((b) => b.text().includes(name)),
        name,
      ).trigger("click");
    await open("README.md");
    await flushPromises();
    onChange(); // mark dirty
    await flushPromises();

    // Declining the confirm aborts the switch — the new file is not loaded.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fakeEditor.setDoc.mockClear();
    await open("notes.txt");
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalled();
    expect(fakeEditor.setDoc).not.toHaveBeenCalled(); // buffer kept

    // Accepting the confirm proceeds with the switch.
    confirmSpy.mockReturnValue(true);
    await open("notes.txt");
    await flushPromises();
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "notes.txt");
    confirmSpy.mockRestore();
  });

  it("guards a route root (cwd) change with a dirty buffer", async () => {
    const w = mountOverlay();
    await flushPromises();
    await must(
      w.findAll('[data-testid="files-row"]').find((b) => b.text().includes("README.md")),
      "readme",
    ).trigger("click");
    await flushPromises();
    onChange(); // mark dirty
    await flushPromises();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fakeEditor.destroy.mockClear();
    hoisted.setCwd("/other-project"); // simulate the Files route changing roots
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalled();
    expect(fakeEditor.destroy).not.toHaveBeenCalled(); // declined → no teardown, buffer kept
    expect(w.text()).toContain("README.md"); // still showing the old root's tree
    confirmSpy.mockRestore();
  });

  it("guards an external close (isOpen=false) with a dirty buffer", async () => {
    const w = mountOverlay();
    await flushPromises();
    await must(
      w.findAll('[data-testid="files-row"]').find((b) => b.text().includes("README.md")),
      "readme",
    ).trigger("click");
    await flushPromises();
    onChange(); // mark dirty
    await flushPromises();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fakeEditor.destroy.mockClear();
    hoisted.setOpen(false); // external navigation (Back / another view) closes the overlay
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalled();
    expect(fakeEditor.destroy).not.toHaveBeenCalled(); // declined → reverted, buffer kept
    expect(w.text()).toContain("README.md"); // overlay still open
    confirmSpy.mockRestore();
  });

  it("lazy-loads a directory's children on expand", async () => {
    const w = mountOverlay();
    await flushPromises();
    const srcRow = must(
      w.findAll('[data-testid="files-row"]').find((b) => b.text().includes("src")),
      "src row",
    );
    await srcRow.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("app.ts"); // child loaded
  });

  it("surfaces a tree load error", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const w = mountOverlay();
    await flushPromises();
    expect(w.text()).toContain("HTTP 500");
  });

  // ?path= — the file a clicked source path in terminal output asks for (#808).
  describe("a file requested by the URL", () => {
    it("opens on arrival, without a tree click", async () => {
      hoisted.setRequestedPath("src/app.ts");
      mountOverlay();
      await flushPromises();
      expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "app.ts");
    });

    it("opens a second requested file while the view is already open", async () => {
      hoisted.setRequestedPath("src/app.ts");
      mountOverlay();
      await flushPromises();
      fakeEditor.setDoc.mockClear();

      hoisted.setRequestedPath("src/other.ts");
      await flushPromises();
      expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "other.ts");
    });

    // Codex flagged the `pathRel === openPath` early-return as stale-content risk when the
    // ROOT changes under the same relative path. It is not: the root-change watcher runs
    // teardown() first, which clears openPath. Pinned here so that stays true — the guard's
    // correctness depends on teardown, which is not visible from the guard itself.
    it("reloads the same relative path when the project root changes", async () => {
      hoisted.setRequestedPath("src/app.ts");
      mountOverlay();
      await flushPromises();
      fakeEditor.setDoc.mockClear();

      const urls: string[] = [];
      const previous = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input));
        return previous(input, init);
      }) as unknown as typeof fetch;

      hoisted.setCwd("/other-proj"); // same path string, different project
      await flushPromises();

      expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "app.ts");
      expect(urls.some((u) => u.includes("%2Fother-proj") && u.includes("src%2Fapp.ts"))).toBe(true);
    });
  });
});
