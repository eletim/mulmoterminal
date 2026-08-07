import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FolderPickerModal from "../../../src/components/FolderPickerModal.vue";

const inBody = (sel: string): HTMLElement | null => document.body.querySelector(sel);
const allInBody = (sel: string): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>(sel)];

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("FolderPickerModal", () => {
  it("keeps the current listing visible when navigating into a directory fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ path: "/home/me", parent: null, directories: [{ name: "private", path: "/home/me/private" }] }),
      })
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    mount(FolderPickerModal, { props: { open: true, initialPath: "/home/me" } });
    await flushPromises();
    allInBody('[data-testid="folder-picker-dir"]')[0]?.click();
    await flushPromises();

    expect(inBody('[data-testid="folder-picker-error"]')?.textContent).toContain("Couldn't load");
    expect(allInBody('[data-testid="folder-picker-dir"]').map((el) => el.textContent?.trim())).toEqual(["folderprivate"]);
    expect((inBody('[data-testid="folder-picker-select"]') as HTMLButtonElement | null)?.disabled).toBe(false);
  });

  it("clears the previous path when reopened before loading the new one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ path: "/old", parent: null, directories: [] }) })
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    const w = mount(FolderPickerModal, { props: { open: true, initialPath: "/old" } });
    await flushPromises();
    expect(inBody('[data-testid="folder-picker-path"]')?.textContent?.trim()).toBe("/old");

    await w.setProps({ open: false });
    await w.setProps({ open: true, initialPath: "/bad" });
    await flushPromises();

    expect(inBody('[data-testid="folder-picker-path"]')?.textContent?.trim()).toBe("");
    expect(inBody('[data-testid="folder-picker-state"]')?.textContent).toContain("Couldn't load");
    expect((inBody('[data-testid="folder-picker-select"]') as HTMLButtonElement | null)?.disabled).toBe(true);
  });
});
