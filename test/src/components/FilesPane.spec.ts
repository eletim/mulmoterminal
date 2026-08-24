import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilesPane from "../../../src/components/FilesPane.vue";

let onChange: () => void = () => {};
let lastReadOnly: boolean | undefined;
const fakeEditor = { setDoc: vi.fn(), getDoc: vi.fn(() => "edited text"), destroy: vi.fn() };
const pubsub = vi.hoisted(() => ({ handlers: new Map<string, (data: unknown) => void>() }));

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, cb: (data: unknown) => void) => {
      pubsub.handlers.set(channel, cb);
      return () => pubsub.handlers.delete(channel);
    },
    onReconnect: () => () => {},
  }),
}));

vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return {
    ...actual,
    createEditor: (_host: HTMLElement, cb: () => void, readOnly?: boolean) => {
      onChange = cb;
      lastReadOnly = readOnly;
      return fakeEditor;
    },
  };
});

function mockFs() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/list")) {
      const p = new URL(url, "https://x").searchParams.get("path");
      return {
        ok: true,
        json: async () => ({
          entries:
            p === ""
              ? [
                  { name: "src", dir: true, size: 0 },
                  { name: "README.md", dir: false, size: 10 },
                ]
              : [{ name: "app.ts", dir: false, size: 5 }],
        }),
      };
    }
    if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
    if (url.includes("/version")) return { ok: true, json: async () => ({ version: "v1" }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

const calls = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
const writeCalls = () => calls().filter((u) => u.includes("/write") || u.includes("/backup"));

describe("FilesPane", () => {
  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    fakeEditor.destroy.mockClear();
    pubsub.handlers.clear();
    lastReadOnly = undefined;
    mockFs();
  });

  it("browses and opens a file as a read-only viewer for the cwd", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();

    expect(w.text()).toContain("README.md");
    await w
      .findAll('[data-testid="files-row"]')
      .find((b) => b.text().includes("README.md"))
      ?.trigger("click");
    await flushPromises();

    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "README.md");
    expect(lastReadOnly).toBe(true);
    expect(String(calls().find((u) => u.includes("/text")))).toContain(encodeURIComponent("/proj"));
  });

  it("does not expose save behaviour or call write endpoints when the editor reports a change", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    await w
      .findAll('[data-testid="files-row"]')
      .find((b) => b.text().includes("README.md"))
      ?.trigger("click");
    await flushPromises();

    onChange();
    await w.trigger("keydown", { key: "s", metaKey: true });
    await (w.vm as unknown as { flush: () => Promise<boolean> }).flush();
    await flushPromises();

    expect(w.findAll("button").some((b) => b.text().startsWith("Save"))).toBe(false);
    expect(w.emitted("dirty")).toBeUndefined();
    expect(writeCalls()).toEqual([]);
  });

  it("closes without attempting to save", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    await w.find('[aria-label="Close files"]').trigger("click");
    await flushPromises();

    expect(w.emitted("close")).toHaveLength(1);
    expect(writeCalls()).toEqual([]);
  });

  it("re-reads the tree only when the host calls reload, not when cwd changes", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj" } });
    await flushPromises();
    expect(calls().filter((u) => u.includes("/list"))).toHaveLength(1);

    await w.setProps({ cwd: "/other" });
    await flushPromises();
    expect(calls().filter((u) => u.includes("/list"))).toHaveLength(1);

    await (w.vm as unknown as { reload: () => Promise<void> }).reload();
    await flushPromises();
    const listCalls = calls().filter((u) => u.includes("/list"));
    expect(listCalls).toHaveLength(2);
    expect(listCalls[1]).toContain(encodeURIComponent("/other"));
  });

  it("opens requested paths and refreshes when an external write changes the open file", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj", requestedPath: "src/app.ts" } });
    await flushPromises();
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "app.ts");

    fakeEditor.setDoc.mockClear();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/version")) return { ok: true, json: async () => ({ version: "v2" }) };
      if (url.includes("/text")) return { ok: true, json: async () => ({ text: "changed", version: "v2" }) };
      return { ok: true, json: async () => ({ entries: [] }) };
    }) as unknown as typeof fetch;

    pubsub.handlers.get("file-write")?.({ file: "/proj/src/app.ts" });
    await flushPromises();
    await flushPromises();
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("changed", "app.ts");
    expect(writeCalls()).toEqual([]);
    w.unmount();
  });
});
