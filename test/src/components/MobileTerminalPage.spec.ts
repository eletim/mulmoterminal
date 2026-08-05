import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import MobileTerminalPage from "../../../src/components/MobileTerminalPage.vue";
import { router } from "../../../src/router/index";

// The page fetches GET /api/mobile-mode on mount, and — only when it answers "local" —
// GET /api/mobile/terminal-sessions, followed by GET /api/mobile/terminal-sessions/:id/screen
// for whichever session ends up selected. Route the mock fetch by path so each test controls
// all three responses independently.
type MockSession = { id: string; title: string; cwd: string; live: boolean; agent: string | null };
type ScreenResult = { ok: true; screen: unknown } | { ok: false; status?: number };

const screenOk = (screen: unknown): ScreenResult => ({ ok: true, screen });
const screenFail = (status = 500): ScreenResult => ({ ok: false, status });

function mockFetch(opts: {
  mode?: "local" | "remote";
  sessions?: MockSession[];
  modeOk?: boolean;
  sessionsOk?: boolean;
  screens?: Record<string, ScreenResult>;
}) {
  const { mode = "local", sessions = [], modeOk = true, sessionsOk = true, screens = {} } = opts;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/mobile-mode") {
      if (!modeOk) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ mode }) };
    }
    if (url === "/api/mobile/terminal-sessions") {
      if (!sessionsOk) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ sessions }) };
    }
    const screenMatch = /^\/api\/mobile\/terminal-sessions\/([^/]+)\/screen$/.exec(url);
    if (screenMatch) {
      const result = screens[decodeURIComponent(screenMatch[1])];
      if (!result) throw new Error(`unexpected screen fetch: ${url}`);
      if (!result.ok) return { ok: false, status: result.status ?? 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ screen: result.screen }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

const session = (over: Partial<MockSession> & { id: string }): MockSession => ({
  title: over.id,
  cwd: `/repo/${over.id}`,
  live: false,
  agent: null,
  ...over,
});

async function mountPage() {
  const wrapper = mount(MobileTerminalPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe("MobileTerminalPage", () => {
  it("checks the mobile mode on mount", async () => {
    mockFetch({ mode: "local", sessions: [] });
    await mountPage();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/mobile-mode");
  });

  it("in local mode, fetches and displays sessions with title, cwd and agent", async () => {
    mockFetch({ mode: "local", sessions: [session({ id: "a", title: "fix bug", cwd: "/repo/a", live: true, agent: "claude" })] });
    const wrapper = await mountPage();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/mobile/terminal-sessions");
    expect(wrapper.text()).toContain("fix bug");
    expect(wrapper.text()).toContain("/repo/a");
    expect(wrapper.text()).toContain("claude");
  });

  it("distinguishes live from detached sessions", async () => {
    mockFetch({
      mode: "local",
      sessions: [session({ id: "live-one", live: true }), session({ id: "detached-one", live: false })],
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("live");
    expect(wrapper.text()).toContain("detached");
  });

  it("in remote mode, shows the disabled message and never fetches sessions", async () => {
    mockFetch({ mode: "remote" });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Local mobile terminal is disabled");
    expect(wrapper.text()).toContain("MULMOTERMINAL_MOBILE_MODE=local");
    expect(globalThis.fetch).not.toHaveBeenCalledWith("/api/mobile/terminal-sessions");
  });

  it("selects the first live session initially", async () => {
    mockFetch({
      mode: "local",
      sessions: [session({ id: "detached-one", live: false }), session({ id: "live-one", live: true })],
    });
    const wrapper = await mountPage();
    const selected = wrapper.get('[class*="border-accent"]');
    expect(selected.text()).toContain("live-one");
  });

  it("selects the first session when none are live", async () => {
    mockFetch({
      mode: "local",
      sessions: [session({ id: "first-one", live: false }), session({ id: "second-one", live: false })],
    });
    const wrapper = await mountPage();
    const selected = wrapper.get('[class*="border-accent"]');
    expect(selected.text()).toContain("first-one");
  });

  it("changes selection when another session is clicked", async () => {
    mockFetch({
      mode: "local",
      sessions: [session({ id: "first-one", live: true }), session({ id: "second-one", live: false })],
    });
    const wrapper = await mountPage();
    const buttons = wrapper.findAll("main li button");
    await buttons[1].trigger("click");
    const selected = wrapper.get('[class*="border-accent"]');
    expect(selected.text()).toContain("second-one");
  });

  it("shows an empty-state message when local mode has no sessions", async () => {
    mockFetch({ mode: "local", sessions: [] });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("No terminal sessions.");
  });

  it("shows an error and retries from the mode check when a fetch fails", async () => {
    mockFetch({ mode: "local", modeOk: false });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Failed to load");
    expect(wrapper.text()).not.toContain("No terminal sessions.");

    mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })] });
    const retryButton = wrapper.findAll("button").find((b) => b.text() === "Retry");
    await retryButton?.trigger("click");
    await flushPromises();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/mobile-mode");
    expect(wrapper.text()).toContain("a");
  });

  // A malformed row must fail the whole load rather than being dropped: silently filtering it
  // out would make the list, the empty state and the initial selection all disagree with what
  // the server actually reported.
  it("shows an error when a session is missing a required field", async () => {
    mockFetch({
      mode: "local",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed wire payload
      sessions: [{ id: "a", title: "fix bug", live: true, agent: null } as any],
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Failed to load");
  });

  it("shows an error when a session has an unrecognised agent", async () => {
    mockFetch({
      mode: "local",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed wire payload
      sessions: [session({ id: "a", live: true, agent: "not-a-real-agent" as any })],
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Failed to load");
  });

  it("does not treat a response with only invalid rows as an empty session list", async () => {
    mockFetch({
      mode: "local",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed wire payload
      sessions: [{ id: "a" } as any],
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).not.toContain("No terminal sessions.");
    expect(wrapper.text()).toContain("Failed to load");
  });

  describe("session screen", () => {
    it("fetches the screen for the initially selected session, once", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("hello") } });
      await mountPage();
      const calls = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input) === "/api/mobile/terminal-sessions/a/screen");
      expect(calls).toHaveLength(1);
    });

    it("displays the fetched screen text, preserving newlines in a <pre> element", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("line1\nline2") } });
      const wrapper = await mountPage();
      const pre = wrapper.find("pre");
      expect(pre.exists()).toBe(true);
      expect(pre.element.textContent).toBe("line1\nline2");
    });

    it("fetches the screen for a newly selected session when another one is clicked", async () => {
      mockFetch({
        mode: "local",
        sessions: [session({ id: "first-one", live: true }), session({ id: "second-one", live: false })],
        screens: { "first-one": screenOk("first"), "second-one": screenOk("second") },
      });
      const wrapper = await mountPage();
      const buttons = wrapper.findAll("main li button");
      await buttons[1].trigger("click");
      await flushPromises();
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/mobile/terminal-sessions/second-one/screen");
    });

    it("does not fetch a screen when there are no sessions", async () => {
      mockFetch({ mode: "local", sessions: [] });
      await mountPage();
      expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/\/screen$/));
    });

    it("does not fetch a screen in remote mode", async () => {
      mockFetch({ mode: "remote" });
      await mountPage();
      expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/\/screen$/));
    });

    it("fetches the screen for a detached (live: false) session too", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "detached-one", live: false })], screens: { "detached-one": screenOk("x") } });
      await mountPage();
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/mobile/terminal-sessions/detached-one/screen");
    });

    it("shows a screen error without losing the session list when the screen fetch fails", async () => {
      mockFetch({
        mode: "local",
        sessions: [session({ id: "a", title: "session-a-title", live: true })],
        screens: { a: screenFail(500) },
      });
      const wrapper = await mountPage();
      expect(wrapper.text()).toContain("Failed to load terminal screen.");
      expect(wrapper.text()).toContain("session-a-title");
    });

    it("shows a screen error when the response's screen field is not a string", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk(123) } });
      const wrapper = await mountPage();
      expect(wrapper.text()).toContain("Failed to load terminal screen.");
    });

    it("retries only the current session's screen, not the mode check or the session list", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenFail(500) } });
      const wrapper = await mountPage();
      expect(wrapper.text()).toContain("Failed to load terminal screen.");

      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("recovered") } });
      const retryButton = wrapper.findAll("button").find((b) => b.text() === "Retry");
      await retryButton?.trigger("click");
      await flushPromises();

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/mobile/terminal-sessions/a/screen");
      expect(globalThis.fetch).not.toHaveBeenCalledWith("/api/mobile-mode");
      expect(globalThis.fetch).not.toHaveBeenCalledWith("/api/mobile/terminal-sessions");
      expect(wrapper.text()).toContain("recovered");
    });

    it("does not display a stale screen response for a session switched away from mid-request", async () => {
      let resolveA: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
      const deferredA = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
        resolveA = resolve;
      });

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
        if (url === "/api/mobile/terminal-sessions")
          return { ok: true, json: async () => ({ sessions: [session({ id: "a", live: true }), session({ id: "b", live: false })] }) };
        if (url === "/api/mobile/terminal-sessions/a/screen") return deferredA;
        if (url === "/api/mobile/terminal-sessions/b/screen") return { ok: true, json: async () => ({ screen: "screen-b" }) };
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      const wrapper = await mountPage();
      // Initial selection is "a" (the first live session); its screen request is still pending.
      const buttons = wrapper.findAll("main li button");
      await buttons[1].trigger("click"); // switch to "b" while A's request is in flight
      await flushPromises();
      expect(wrapper.text()).toContain("screen-b");

      resolveA({ ok: true, json: async () => ({ screen: "screen-a" }) });
      await flushPromises();

      expect(wrapper.text()).not.toContain("screen-a");
      expect(wrapper.text()).toContain("screen-b");
    });
  });
});
