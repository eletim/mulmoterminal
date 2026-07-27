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

// What /text serves and how /write answers, so a test can make the file change underneath
// the editor (the agent-wrote-it-too case) without a second fetch mock.
const disk = { text: "# hello", version: "v1" };
let writeConflictVersion: string | null = null;

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
    if (url.includes("/text")) return { ok: true, json: async () => ({ text: disk.text, version: disk.version }) };
    // The backup store is a separate endpoint and must not fall into the /write branch below —
    // banking is what makes "discard" safe, so a failing bank correctly refuses to discard.
    if (url.includes("/backup")) return { ok: true, json: async () => ({ stored: true }) };
    if (url.includes("/write")) {
      if (writeConflictVersion !== null) {
        return { ok: false, status: 409, json: async () => ({ error: "file changed on disk", version: writeConflictVersion }) };
      }
      return { ok: true, json: async () => ({ ok: true, version: "v2" }), _init: init };
    }
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
    disk.text = "# hello";
    disk.version = "v1";
    writeConflictVersion = null;
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
    // The version the buffer was loaded from rides along, so the server can refuse a write
    // that would clobber whoever else touched the file meanwhile.
    expect(JSON.parse(putCall[1].body)).toEqual({ text: "edited text", baseVersion: "v1" });
  });

  // The confirm dialogs are gone: leaving an open file SAVES it, wherever the leaving comes
  // from. The server keeps three generations of whatever a save replaces, so nothing that was
  // typed is lost either way — and the reader never gets a modal between them and a terminal.
  const openAndDirty = async (w: ReturnType<typeof mount>, name = "README.md") => {
    await must(
      w.findAll('[data-testid="files-row"]').find((b) => b.text().includes(name)),
      name,
    ).trigger("click");
    await flushPromises();
    onChange();
    await flushPromises();
  };
  const writeCalls = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("/write"));

  it("saves the open file before switching to another, without asking", async () => {
    const w = mountOverlay();
    await flushPromises();
    await openAndDirty(w);

    const confirmSpy = vi.spyOn(window, "confirm");
    await must(
      w.findAll('[data-testid="files-row"]').find((b) => b.text().includes("notes.txt")),
      "notes.txt",
    ).trigger("click");
    await flushPromises();

    expect(writeCalls()).toHaveLength(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "notes.txt"); // the switch happened
    confirmSpy.mockRestore();
  });

  it("saves before the route changes root, then re-reads at the new one", async () => {
    const w = mountOverlay();
    await flushPromises();
    await openAndDirty(w);

    const confirmSpy = vi.spyOn(window, "confirm");
    hoisted.setCwd("/other-project");
    await flushPromises();

    expect(writeCalls()).toHaveLength(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    // The save must be built from the OLD root, or it would write to a file of the same
    // relative path in the project the user just moved to.
    expect(String(writeCalls()[0][0])).toContain(encodeURIComponent("/proj"));
    confirmSpy.mockRestore();
  });

  it("saves when an external navigation closes the view", async () => {
    const w = mountOverlay();
    await flushPromises();
    await openAndDirty(w);

    const confirmSpy = vi.spyOn(window, "confirm");
    hoisted.setOpen(false); // Back / another view
    await flushPromises();

    expect(writeCalls()).toHaveLength(1);
    expect(confirmSpy).not.toHaveBeenCalled();
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

  // The agent running in this very directory edits the same files, so "someone else wrote it
  // while you had it open" is the normal case here, not the exotic one.
  describe("a save the server refuses (409)", () => {
    const conflictBanner = (w: ReturnType<typeof mount>) => w.find('[data-testid="files-conflict"]');
    const clickButton = async (w: ReturnType<typeof mount>, label: string) => {
      await must(
        w.findAll("button").find((b) => b.text().startsWith(label)),
        `${label} btn`,
      ).trigger("click");
      await flushPromises();
    };
    const openAndEdit = async () => {
      const w = mountOverlay();
      await flushPromises();
      await must(
        w.findAll('[data-testid="files-row"]').find((b) => b.text().includes("README.md")),
        "README row",
      ).trigger("click");
      await flushPromises();
      onChange(); // dirty
      await flushPromises();
      return w;
    };

    it("shows the banner and keeps the buffer instead of reporting a plain error", async () => {
      writeConflictVersion = "v9";
      const w = await openAndEdit();
      await clickButton(w, "Save");
      expect(conflictBanner(w).exists()).toBe(true);
      expect(w.text()).toContain("Nothing was saved");
      // Still dirty: the edits are the whole point of offering the choice.
      const saveBtn = must(
        w.findAll("button").find((b) => b.text().startsWith("Save")),
        "save btn",
      );
      expect(saveBtn.attributes("disabled")).toBeUndefined();
    });

    it("Reload takes the disk's copy, banking the buffer first and never prompting", async () => {
      writeConflictVersion = "v9";
      const w = await openAndEdit();
      await clickButton(w, "Save");

      disk.text = "# the agent's version";
      disk.version = "v9";
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      await clickButton(w, "Reload");
      // The version being dropped goes to the backup store before it is dropped.
      const banked = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes("/backup"));
      expect(banked).toBe(true);

      // The button IS the decision — prompting again would ask the same question twice.
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(fakeEditor.setDoc).toHaveBeenLastCalledWith("# the agent's version", "README.md");
      expect(conflictBanner(w).exists()).toBe(false);
      confirmSpy.mockRestore();
    });

    it("Overwrite re-sends with the disk's version, so the retry writes instead of conflicting", async () => {
      writeConflictVersion = "v9";
      const w = await openAndEdit();
      await clickButton(w, "Save");

      writeConflictVersion = null; // the retry is allowed through
      await clickButton(w, "Overwrite");

      const writes = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("/write"));
      expect(writes).toHaveLength(2);
      expect(JSON.parse(writes[0][1].body).baseVersion).toBe("v1");
      expect(JSON.parse(writes[1][1].body).baseVersion).toBe("v9");
      expect(conflictBanner(w).exists()).toBe(false);
    });
  });
});
