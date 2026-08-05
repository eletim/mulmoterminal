import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import MobileTerminalPage from "../../../src/components/MobileTerminalPage.vue";
import { router } from "../../../src/router/index";

// The page fetches GET /api/mobile-mode on mount, and — only when it answers "local" —
// GET /api/mobile/terminal-sessions. Route the mock fetch by path so each test controls
// both responses independently.
type MockSession = { id: string; title: string; cwd: string; live: boolean; agent: string | null };

function mockFetch(opts: { mode?: "local" | "remote"; sessions?: MockSession[]; modeOk?: boolean; sessionsOk?: boolean }) {
  const { mode = "local", sessions = [], modeOk = true, sessionsOk = true } = opts;
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
});
