import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TimelineOverlay from "../../../src/components/TimelineOverlay.vue";

const events = [
  { ts: "2026-06-29T04:42:01.468Z", tool: "Bash", summary: "git status" },
  { ts: "2026-06-29T04:42:12.806Z", tool: "Read", summary: "/a/b.ts" },
];

const mockFetch = (payload: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(payload) });

// The overlay teleports to <body> (#968), so none of its content is inside the wrapper's own
// tree — `w.find` would miss all of it. Query the document instead, and clear <body> between
// tests: a teleported node outlives its wrapper, so a leftover one is visible to the next test.
const inBody = (sel: string): HTMLElement | null => document.body.querySelector(sel);
const allInBody = (sel: string): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>(sel)];
const textIn = (root: HTMLElement, sel: string): string => root.querySelector(sel)?.textContent?.trim() ?? "";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("TimelineOverlay", () => {
  it("renders nothing when closed", () => {
    mount(TimelineOverlay, { props: { sessionId: "s", cwd: "/x", open: false } });
    expect(inBody('[data-testid="tl-modal"]')).toBeNull();
  });

  it("loads and lists tool events newest-first when opened", async () => {
    vi.stubGlobal("fetch", mockFetch({ events, truncated: false }));
    mount(TimelineOverlay, { props: { sessionId: "s", cwd: "/x", open: true } });
    await flushPromises();
    const rows = allInBody('[data-testid="tl-row"]');
    expect(rows).toHaveLength(2);
    // newest (Read) first
    expect(textIn(rows[0], '[data-testid="tl-tool"]')).toBe("Read");
    expect(textIn(rows[1], '[data-testid="tl-tool"]')).toBe("Bash");
    expect(inBody('[data-testid="tl-count"]')?.textContent).toContain("2 steps");
  });

  it("shows an empty state when there is no activity", async () => {
    vi.stubGlobal("fetch", mockFetch({ events: [], truncated: false }));
    mount(TimelineOverlay, { props: { sessionId: "s", cwd: "/x", open: true } });
    await flushPromises();
    expect(inBody('[data-testid="tl-empty"]')?.textContent).toContain("No tool activity");
  });

  it("shows an error state when the fetch fails", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false));
    mount(TimelineOverlay, { props: { sessionId: "s", cwd: "/x", open: true } });
    await flushPromises();
    expect(inBody('[data-testid="tl-empty"]')?.textContent).toContain("Couldn't load");
  });

  it("emits close from the ✕ button", async () => {
    vi.stubGlobal("fetch", mockFetch({ events, truncated: false }));
    const w = mount(TimelineOverlay, { props: { sessionId: "s", cwd: "/x", open: true } });
    await flushPromises();
    inBody('[data-testid="tl-close"]')?.click();
    await flushPromises();
    expect(w.emitted("close")).toBeTruthy();
  });

  it("closes on a document-level Escape keydown (focus-independent)", async () => {
    vi.stubGlobal("fetch", mockFetch({ events, truncated: false }));
    const w = mount(TimelineOverlay, { attachTo: document.body, props: { sessionId: "s", cwd: "/x", open: true } });
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("ignores a stale response superseded by a newer open", async () => {
    const resp = (payload: unknown) => ({ ok: true, json: () => Promise.resolve(payload) });
    let resolveStale: (v: unknown) => void = () => {};
    const stale = new Promise((r) => {
      resolveStale = r;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(stale) // first open (session a) resolves LAST
      .mockResolvedValueOnce(resp({ events: [{ ts: "t", tool: "Read", summary: "B" }], truncated: false }));
    vi.stubGlobal("fetch", fetchMock);

    const w = mount(TimelineOverlay, { props: { sessionId: "a", cwd: "/x", open: true } });
    await w.setProps({ open: false });
    await w.setProps({ sessionId: "b", open: true }); // second open supersedes the first
    await flushPromises();
    resolveStale(resp({ events: [{ ts: "t", tool: "Bash", summary: "A" }], truncated: false }));
    await flushPromises();

    expect(allInBody('[data-testid="tl-tool"]').map((n) => n.textContent)).toEqual(["Read"]); // newest wins, stale ignored
    w.unmount();
  });

  it("clears the truncated flag on a later error (no stale '+')", async () => {
    const okTrunc = { ok: true, json: () => Promise.resolve({ events, truncated: true }) };
    const fail = { ok: false, json: () => Promise.resolve({}) };
    const fetchMock = vi.fn().mockResolvedValueOnce(okTrunc).mockResolvedValueOnce(fail);
    vi.stubGlobal("fetch", fetchMock);
    const w = mount(TimelineOverlay, { props: { sessionId: "a", cwd: "/x", open: true } });
    await flushPromises();
    expect(inBody('[data-testid="tl-count"]')?.textContent).toContain("+");
    await w.setProps({ sessionId: "b" }); // reload → error
    await flushPromises();
    expect(inBody('[data-testid="tl-count"]')?.textContent).not.toContain("+");
    w.unmount();
  });

  it("reloads when the session changes while the overlay stays open", async () => {
    const fetchMock = mockFetch({ events, truncated: false });
    vi.stubGlobal("fetch", fetchMock);
    const w = mount(TimelineOverlay, { props: { sessionId: "a", cwd: "/x", open: true } });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await w.setProps({ sessionId: "b" });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    w.unmount();
  });

  // #968: the modal must not render inside whatever used it. The grid scales the focused cell
  // with `transform`, and a transformed ancestor becomes the containing block for
  // `position: fixed` — so rendered in place, this `fixed inset-0` root took the CELL's rect and
  // the cell's `overflow: hidden` cropped it. Teleporting to body is what keeps it full-screen.
  it("renders into body, outside the component's own tree", async () => {
    vi.stubGlobal("fetch", mockFetch({ events, truncated: false }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const w = mount(TimelineOverlay, { attachTo: host, props: { sessionId: "s", cwd: "/x", open: true } });
    await flushPromises();

    const modal = inBody('[data-testid="tl-modal"]');
    expect(modal).not.toBeNull();
    expect(host.contains(modal)).toBe(false); // NOT under the mount point
    expect(modal?.closest("body")).toBe(document.body);
    w.unmount();
  });
});
