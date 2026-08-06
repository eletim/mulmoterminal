import { afterEach, describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import MobileTerminalPage from "../../../src/components/MobileTerminalPage.vue";
import { router } from "../../../src/router/index";

// The page fetches GET /api/mobile-mode on mount, and — only when it answers "local" —
// GET /api/mobile/terminal-sessions, followed by GET /api/mobile/terminal-sessions/:id/screen
// for whichever session ends up selected. Route the mock fetch by path so each test controls
// all three responses independently.
type MockActivity = { working: boolean; waiting: boolean; event: string | null; workPhase: "planning" | "implementing" | null };
type MockSession = { id: string; title: string; cwd: string; live: boolean; agent: string | null; activity: MockActivity };
type ScreenResult = { ok: true; screen: unknown } | { ok: false; status?: number };
type InputResult = { ok: true; body: unknown } | { ok: false; status?: number };
type CreateResult = { ok: true; body?: unknown } | { ok: false; status?: number; body?: unknown };
type WebPushResult = { ok: true; body?: unknown } | { ok: false; status?: number; body?: unknown };

const screenOk = (screen: unknown): ScreenResult => ({ ok: true, screen });
const screenFail = (status = 500): ScreenResult => ({ ok: false, status });

const inputOk = (): InputResult => ({ ok: true, body: { sent: true } });
const inputBadBody = (body: unknown): InputResult => ({ ok: true, body });
const inputFail = (status = 500): InputResult => ({ ok: false, status });
const createOk = (body: unknown = { ok: true, sessionId: "created" }): CreateResult => ({ ok: true, body });
const createFail = (status = 500, body: unknown = {}): CreateResult => ({ ok: false, status, body });
const webPushOk = (body: unknown = { ok: true }): WebPushResult => ({ ok: true, body });

type MockFetchResponse = { ok: boolean; status?: number; json: () => Promise<unknown> };
type MockNotificationGlobal = {
  permission: NotificationPermission;
  requestPermission: ReturnType<typeof vi.fn<() => Promise<NotificationPermission>>>;
};

const originalNotificationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Notification");
const originalPushManagerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "PushManager");
const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

function restoreDescriptor(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreDescriptor(globalThis, "Notification", originalNotificationDescriptor);
  restoreDescriptor(globalThis, "PushManager", originalPushManagerDescriptor);
  restoreDescriptor(navigator, "serviceWorker", originalServiceWorkerDescriptor);
  await router.push("/");
});

// Split out of mockFetch's routing so that function stays a flat list of if-checks — each
// helper owns one endpoint's own "not this URL" / "unmapped id" / "ok vs. fail" branching.
function screenResponse(url: string, screens: Record<string, ScreenResult>): MockFetchResponse | null {
  const match = /^\/api\/mobile\/terminal-sessions\/([^/]+)\/screen$/.exec(url);
  if (!match) return null;
  const result = screens[decodeURIComponent(match[1])];
  if (!result) throw new Error(`unexpected screen fetch: ${url}`);
  if (!result.ok) return { ok: false, status: result.status ?? 500, json: async () => ({}) };
  return { ok: true, json: async () => ({ screen: result.screen }) };
}

function inputResponse(url: string, inputs: Record<string, InputResult>): MockFetchResponse | null {
  const match = /^\/api\/mobile\/terminal-sessions\/([^/]+)\/input$/.exec(url);
  if (!match) return null;
  const result = inputs[decodeURIComponent(match[1])];
  if (!result) throw new Error(`unexpected input fetch: ${url}`);
  if (!result.ok) return { ok: false, status: result.status ?? 500, json: async () => ({}) };
  return { ok: true, json: async () => result.body };
}

function webPushResponse(result: WebPushResult): MockFetchResponse {
  if (!result.ok) return { ok: false, status: result.status ?? 500, json: async () => result.body ?? {} };
  return { ok: true, json: async () => result.body ?? {} };
}

function webPushRouteResponse(url: string, init: RequestInit | undefined, routes: Record<string, WebPushResult>): MockFetchResponse | null {
  const result = routes[`${init?.method ?? "GET"} ${url}`];
  return result ? webPushResponse(result) : null;
}

function mockFetch(opts: {
  mode?: "local" | "remote";
  sessions?: MockSession[];
  modeOk?: boolean;
  sessionsOk?: boolean;
  screens?: Record<string, ScreenResult>;
  inputs?: Record<string, InputResult>;
  create?: CreateResult;
  webPushConfig?: WebPushResult;
  webPushRegister?: WebPushResult;
  webPushUnregister?: WebPushResult;
  webPushTest?: WebPushResult;
}) {
  const {
    mode = "local",
    sessions = [],
    modeOk = true,
    sessionsOk = true,
    screens = {},
    inputs = {},
    create = createOk(),
    webPushConfig = webPushOk({ enabled: true, publicKey: "AQID" }),
    webPushRegister = webPushOk({ ok: true, created: true, subscriptions: 1 }),
    webPushUnregister = webPushOk({ ok: true, removed: true, subscriptions: 0 }),
    webPushTest = webPushOk({ ok: true, sent: 1, failed: 0, targets: 1, removed: 0 }),
  } = opts;
  const webPushRoutes: Record<string, WebPushResult> = {
    "GET /api/mobile/web-push/config": webPushConfig,
    "POST /api/mobile/web-push/subscriptions": webPushRegister,
    "DELETE /api/mobile/web-push/subscriptions": webPushUnregister,
    "POST /api/mobile/web-push/test": webPushTest,
  };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/mobile-mode") {
      if (!modeOk) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ mode }) };
    }
    if (url === "/api/mobile/terminal-sessions") {
      if (init?.method === "POST") {
        if (!create.ok) return { ok: false, status: create.status ?? 500, json: async () => create.body ?? {} };
        return { ok: true, json: async () => create.body ?? { ok: true } };
      }
      if (!sessionsOk) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ sessions }) };
    }
    const webPush = webPushRouteResponse(url, init, webPushRoutes);
    if (webPush) return webPush;
    const input_ = inputResponse(url, inputs);
    if (input_) return input_;
    const screen = screenResponse(url, screens);
    if (screen) return screen;
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

function mockWebPush(opts: {
  permission?: NotificationPermission;
  requestPermission?: NotificationPermission;
  existingSubscription?: PushSubscription | null;
  subscribeFails?: boolean;
}) {
  const notification: MockNotificationGlobal = {
    permission: opts.permission ?? "default",
    requestPermission: vi.fn(async () => {
      notification.permission = opts.requestPermission ?? "granted";
      return notification.permission;
    }),
  };

  const subscription =
    opts.existingSubscription ??
    ({
      endpoint: "https://push.example/subscription",
      toJSON: () => ({ endpoint: "https://push.example/subscription", keys: { p256dh: "p256dh", auth: "auth" } }),
      unsubscribe: vi.fn(async () => true),
    } as unknown as PushSubscription);

  let currentSubscription: PushSubscription | null = opts.existingSubscription === null ? null : subscription;
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => currentSubscription),
      subscribe: vi.fn(async () => {
        if (opts.subscribeFails) throw new Error("subscribe failed");
        currentSubscription = subscription;
        return subscription;
      }),
    },
    showNotification: vi.fn(async () => undefined),
  };

  Object.defineProperty(globalThis, "Notification", { configurable: true, value: notification });
  Object.defineProperty(globalThis, "PushManager", { configurable: true, value: {} });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn(async () => registration) },
  });

  return { notification, registration, subscription };
}

const IDLE_ACTIVITY: MockActivity = { working: false, waiting: false, event: null, workPhase: null };

const session = (over: Partial<MockSession> & { id: string }): MockSession => ({
  title: over.id,
  cwd: `/repo/${over.id}`,
  live: false,
  agent: null,
  activity: IDLE_ACTIVITY,
  ...over,
});

async function mountPage() {
  const wrapper = mount(MobileTerminalPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

// Prefer a thrown "not found" over a non-null assertion at every call site below.
function findButton(wrapper: Awaited<ReturnType<typeof mountPage>>, text: string) {
  const button = wrapper.findAll("button").find((b) => b.text() === text);
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

function screenCallCount(id: string): number {
  return vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input) === `/api/mobile/terminal-sessions/${id}/screen`).length;
}

// Sets document.visibilityState, dispatches visibilitychange (which MobileTerminalPage's
// listener handles synchronously), then restores the original property — so no test leaks a
// stubbed visibilityState into the next one.
function fireVisibilityChange(state: DocumentVisibilityState): void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
  try {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    document.dispatchEvent(new Event("visibilitychange"));
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(document, "visibilityState", originalDescriptor);
    } else {
      delete (document as Omit<Document, "visibilityState"> & { visibilityState?: DocumentVisibilityState }).visibilityState;
    }
  }
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

  describe("session activity", () => {
    it("shows the activity status alongside live/detached", async () => {
      mockFetch({
        mode: "local",
        sessions: [session({ id: "a", live: true, activity: { working: true, waiting: false, event: null, workPhase: null } })],
      });
      const wrapper = await mountPage();
      expect(wrapper.text()).toContain("running · live");
    });

    it("names the work phase for a working session", async () => {
      mockFetch({
        mode: "local",
        sessions: [session({ id: "a", live: true, activity: { working: true, waiting: false, event: null, workPhase: "planning" } })],
      });
      const wrapper = await mountPage();
      expect(wrapper.text()).toContain("planning · live");
    });

    it("shows needs input for a Notification wait, and done for a Stop wait", async () => {
      mockFetch({
        mode: "local",
        sessions: [
          session({ id: "a", live: false, activity: { working: false, waiting: true, event: "Notification", workPhase: null } }),
          session({ id: "b", live: false, activity: { working: false, waiting: true, event: "Stop", workPhase: null } }),
        ],
      });
      const wrapper = await mountPage();
      expect(wrapper.text()).toContain("needs input · detached");
      expect(wrapper.text()).toContain("done · detached");
    });

    it("shows idle for a session with no activity recorded", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: false })] });
      const wrapper = await mountPage();
      expect(wrapper.text()).toContain("idle · detached");
    });

    describe("polling", () => {
      it("refetches the session list on an interval while the tab is visible", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        try {
          mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
          await mountPage();

          // Re-mocking resets the fetch spy's own call history (the pattern the manual-refresh
          // tests above already use), so what is being counted below is calls made AFTER this
          // point — one poll tick, not the initial load plus a poll.
          mockFetch({
            mode: "local",
            sessions: [session({ id: "a", live: true, activity: { working: true, waiting: false, event: null, workPhase: null } })],
            screens: { a: screenOk("v1") },
          });
          vi.advanceTimersByTime(2000); // exactly one poll interval
          await flushPromises();

          const sessionsCalls = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input) === "/api/mobile/terminal-sessions");
          expect(sessionsCalls).toHaveLength(1);
        } finally {
          vi.useRealTimers();
        }
      });

      it("reflects a status change from a poll without any user action", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        try {
          mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
          const wrapper = await mountPage();
          expect(wrapper.text()).toContain("idle · live");

          mockFetch({
            mode: "local",
            sessions: [session({ id: "a", live: true, activity: { working: true, waiting: false, event: null, workPhase: "implementing" } })],
            screens: { a: screenOk("v1") },
          });
          vi.advanceTimersByTime(2000);
          await flushPromises();

          expect(wrapper.text()).toContain("implementing · live");
        } finally {
          vi.useRealTimers();
        }
      });

      it("does not poll while the tab is hidden", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        try {
          mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
          await mountPage();
          const initialCalls = vi.mocked(globalThis.fetch).mock.calls.length;

          Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
          try {
            vi.advanceTimersByTime(6000); // several poll intervals' worth
            await flushPromises();
          } finally {
            Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
          }

          expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(initialCalls); // no polls fired while hidden
        } finally {
          vi.useRealTimers();
        }
      });

      it("keeps the current selection across a poll when it still exists", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        try {
          mockFetch({
            mode: "local",
            sessions: [session({ id: "a", live: true }), session({ id: "b", live: true })],
            screens: { a: screenOk("screen-a"), b: screenOk("screen-b") },
          });
          const wrapper = await mountPage();
          const buttons = wrapper.findAll("main li button");
          await buttons[1].trigger("click"); // select "b"
          await flushPromises();
          expect(wrapper.get('[class*="border-accent"]').text()).toContain("b");

          // The poll returns the same two sessions, reordered — selection must not bounce to "a".
          mockFetch({
            mode: "local",
            sessions: [session({ id: "b", live: true }), session({ id: "a", live: true })],
            screens: { a: screenOk("screen-a"), b: screenOk("screen-b") },
          });
          vi.advanceTimersByTime(2000);
          await flushPromises();

          expect(wrapper.get('[class*="border-accent"]').text()).toContain("b");
        } finally {
          vi.useRealTimers();
        }
      });

      it("falls back to the first live session when the selected one disappears from a poll", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        try {
          mockFetch({
            mode: "local",
            sessions: [session({ id: "a", live: true }), session({ id: "b", live: true })],
            screens: { a: screenOk("screen-a"), b: screenOk("screen-b") },
          });
          const wrapper = await mountPage();
          const buttons = wrapper.findAll("main li button");
          await buttons[1].trigger("click"); // select "b"
          await flushPromises();

          // "b" is gone from the next poll.
          mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("screen-a") } });
          vi.advanceTimersByTime(2000);
          await flushPromises();

          expect(wrapper.get('[class*="border-accent"]').text()).toContain("a");
          expect(wrapper.text()).toContain("screen-a");
        } finally {
          vi.useRealTimers();
        }
      });

      // A poll auto-switching the selection away from a session that disappeared must go through
      // the exact same reset as a manual click — otherwise a line typed for the vanished session
      // could still be sent to whatever the fallback landed on, and a "sending"/"error" input
      // status left over from it would leave the new selection's input looking busy or broken.
      describe("automatic selection change (poll fallback)", () => {
        it("clears typed input and a stuck error status when a poll auto-switches away from a disappeared session", async () => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
          try {
            mockFetch({
              mode: "local",
              sessions: [session({ id: "a", live: true }), session({ id: "b", live: true })],
              screens: { a: screenOk("screen-a"), b: screenOk("screen-b") },
              inputs: { b: inputFail(500) },
            });
            const wrapper = await mountPage();
            const buttons = wrapper.findAll("main li button");
            await buttons[1].trigger("click"); // select "b"
            await flushPromises();

            const inputEl = () => wrapper.find('footer input[type="text"]');
            await inputEl().setValue("leftover for b");
            await wrapper.find("form").trigger("submit");
            await flushPromises();
            expect(wrapper.text()).toContain("Failed to send terminal input.");

            // "b" is gone from the next poll — falls back to "a".
            mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("screen-a") } });
            vi.advanceTimersByTime(2000);
            await flushPromises();

            expect(wrapper.get('[class*="border-accent"]').text()).toContain("a");
            expect(wrapper.text()).not.toContain("Failed to send terminal input.");
            expect((inputEl().element as HTMLInputElement).value).toBe("");
          } finally {
            vi.useRealTimers();
          }
        });

        it("does not let a stale send response from a session that disappeared via polling affect the fallback session's input", async () => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
          try {
            let resolveInputB: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
            const deferredInputB = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
              resolveInputB = resolve;
            });
            let sessionsNow: MockSession[] = [session({ id: "a", live: true }), session({ id: "b", live: true })];

            globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
              const url = String(input);
              if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
              if (url === "/api/mobile/terminal-sessions") return { ok: true, json: async () => ({ sessions: sessionsNow }) };
              if (url === "/api/mobile/terminal-sessions/a/screen") return { ok: true, json: async () => ({ screen: "screen-a" }) };
              if (url === "/api/mobile/terminal-sessions/b/screen") return { ok: true, json: async () => ({ screen: "screen-b" }) };
              if (url === "/api/mobile/terminal-sessions/b/input") return deferredInputB;
              throw new Error(`unexpected fetch: ${url}`);
            }) as unknown as typeof fetch;

            const wrapper = await mountPage();
            const buttons = wrapper.findAll("main li button");
            await buttons[1].trigger("click"); // select "b"
            await flushPromises();

            const inputEl = () => wrapper.find('footer input[type="text"]');
            await inputEl().setValue("echo from b");
            await wrapper.find("form").trigger("submit"); // b's send is now pending
            await flushPromises();

            // "b" disappears from the list before its send resolves — falls back to "a".
            sessionsNow = [session({ id: "a", live: true })];
            vi.advanceTimersByTime(2000);
            await flushPromises();
            expect(wrapper.get('[class*="border-accent"]').text()).toContain("a");

            await inputEl().setValue("echo from a");

            // b's response finally arrives, as a failure — it must not touch a's input state.
            resolveInputB({ ok: false, json: async () => ({}) });
            await flushPromises();

            expect((inputEl().element as HTMLInputElement).value).toBe("echo from a");
            expect(wrapper.text()).not.toContain("Failed to send terminal input.");
          } finally {
            vi.useRealTimers();
          }
        });

        it("clears selection, screen and input state when the session list becomes empty via polling", async () => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
          try {
            mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("screen-a") } });
            const wrapper = await mountPage();
            await wrapper.find('footer input[type="text"]').setValue("leftover");

            mockFetch({ mode: "local", sessions: [] });
            vi.advanceTimersByTime(2000);
            await flushPromises();

            expect(wrapper.text()).toContain("No terminal sessions.");
            expect(wrapper.find('footer input[type="text"]').exists()).toBe(false);
          } finally {
            vi.useRealTimers();
          }
        });
      });

      // The 2s interval and the visibilitychange resume handler both call refreshSessionList();
      // without a shared in-flight guard, a slow response and an overlapping trigger can resolve
      // out of order and the older one's applySessionList() call would clobber newer state.
      describe("request de-duplication", () => {
        it("does not start a second session list fetch while one is in flight, and retries once it settles", async () => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
          try {
            mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
            await mountPage();

            let resolvePoll: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
            const deferredPoll = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
              resolvePoll = resolve;
            });
            let sessionsCallCount = 0;
            globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
              const url = String(input);
              if (url === "/api/mobile/terminal-sessions") {
                sessionsCallCount += 1;
                return deferredPoll;
              }
              if (url === "/api/mobile/terminal-sessions/a/screen") return { ok: true, json: async () => ({ screen: "v1" }) };
              throw new Error(`unexpected fetch: ${url}`);
            }) as unknown as typeof fetch;

            vi.advanceTimersByTime(2000); // first poll tick starts a request and leaves it pending
            await flushPromises();
            expect(sessionsCallCount).toBe(1);

            // A tab-resume overlapping the still-pending poll must not add a second request.
            fireVisibilityChange("visible");
            await flushPromises();
            expect(sessionsCallCount).toBe(1);

            // Also true of a second interval tick landing before the first request settles.
            vi.advanceTimersByTime(2000);
            await flushPromises();
            expect(sessionsCallCount).toBe(1);

            resolvePoll({ ok: true, json: async () => ({ sessions: [session({ id: "a", live: true })] }) });
            await flushPromises();

            // Once the in-flight request has settled, the guard is released and the next tick fetches again.
            vi.advanceTimersByTime(2000);
            await flushPromises();
            expect(sessionsCallCount).toBe(2);
          } finally {
            vi.useRealTimers();
          }
        });

        it("releases the in-flight guard after a failed poll so the next interval can retry", async () => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
          try {
            mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
            const wrapper = await mountPage();

            mockFetch({ mode: "local", sessions: [], sessionsOk: false }); // this poll fails
            vi.advanceTimersByTime(2000);
            await flushPromises();

            mockFetch({
              mode: "local",
              sessions: [session({ id: "a", live: true, activity: { working: true, waiting: false, event: null, workPhase: null } })],
              screens: { a: screenOk("v1") },
            });
            vi.advanceTimersByTime(2000);
            await flushPromises();

            // The next poll after the failure succeeded — the guard was released, not left stuck.
            expect(wrapper.text()).toContain("running · live");
          } finally {
            vi.useRealTimers();
          }
        });
      });

      it("does not empty the visible list when a poll fails", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        try {
          mockFetch({ mode: "local", sessions: [session({ id: "a", title: "keep-me", live: true })], screens: { a: screenOk("v1") } });
          const wrapper = await mountPage();
          expect(wrapper.text()).toContain("keep-me");

          mockFetch({ mode: "local", sessions: [], sessionsOk: false });
          vi.advanceTimersByTime(2000);
          await flushPromises();

          // The failed poll must not have blanked the list still showing "keep-me".
          expect(wrapper.text()).toContain("keep-me");
          expect(wrapper.text()).not.toContain("No terminal sessions.");
          expect(wrapper.text()).not.toContain("Failed to load");
        } finally {
          vi.useRealTimers();
        }
      });

      it("clears the poll interval on unmount", async () => {
        mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
        const wrapper = await mountPage();

        const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
        wrapper.unmount();

        expect(clearIntervalSpy).toHaveBeenCalled();
        clearIntervalSpy.mockRestore();
      });
    });
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

  describe("new terminal", () => {
    function cwdInput(wrapper: Awaited<ReturnType<typeof mountPage>>) {
      return wrapper.find('input[placeholder="/path/to/project"]');
    }

    function agentSelect(wrapper: Awaited<ReturnType<typeof mountPage>>) {
      return wrapper.find("select");
    }

    it("shows a local new-terminal launcher and pre-fills cwd from the selected session", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", cwd: "/repo/a", live: true })], screens: { a: screenOk("hello") } });
      const wrapper = await mountPage();
      expect(wrapper.text()).toContain("New terminal");
      expect((cwdInput(wrapper).element as HTMLInputElement).value).toBe("/repo/a");
      expect(agentSelect(wrapper).text()).toContain("shell");
      expect(agentSelect(wrapper).text()).toContain("codex");
    });

    it("keeps the launcher visible even when there are no sessions", async () => {
      mockFetch({ mode: "local", sessions: [] });
      const wrapper = await mountPage();
      expect(wrapper.text()).toContain("No terminal sessions.");
      expect(wrapper.text()).toContain("New terminal");
      expect(cwdInput(wrapper).exists()).toBe(true);
    });

    it("POSTs only agent and cwd, then refreshes sessions and selects the created terminal", async () => {
      let sessionsCall = 0;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
        if (url === "/api/mobile/terminal-sessions" && init?.method === "POST") return { ok: true, json: async () => ({ ok: true, sessionId: "created" }) };
        if (url === "/api/mobile/terminal-sessions") {
          sessionsCall += 1;
          const rows =
            sessionsCall === 1
              ? [session({ id: "a", cwd: "/repo/a", live: true })]
              : [session({ id: "a", cwd: "/repo/a", live: true }), session({ id: "created", cwd: "/repo/b", title: "created", live: true, agent: "codex" })];
          return { ok: true, json: async () => ({ sessions: rows }) };
        }
        if (url === "/api/mobile/terminal-sessions/a/screen") return { ok: true, json: async () => ({ screen: "screen-a" }) };
        if (url === "/api/mobile/terminal-sessions/created/screen") return { ok: true, json: async () => ({ screen: "screen-created" }) };
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      const wrapper = await mountPage();
      await cwdInput(wrapper).setValue("/repo/b");
      await agentSelect(wrapper).setValue("codex");
      await findButton(wrapper, "Start").trigger("click");
      await flushPromises();

      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url) === "/api/mobile/terminal-sessions" && init?.method === "POST");
      if (!post) throw new Error("create POST not found");
      expect(post[1]?.headers).toMatchObject({ "Content-Type": "application/json" });
      expect(post[1]?.body).toBe(JSON.stringify({ agent: "codex", cwd: "/repo/b" }));
      expect(post[1]?.body).not.toContain("command");
      expect(wrapper.get('[class*="border-accent"]').text()).toContain("created");
      expect(wrapper.text()).toContain("screen-created");
    });

    it("selects the session resolved for the create request, not the first unrelated new row", async () => {
      let sessionsCall = 0;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
        if (url === "/api/mobile/terminal-sessions" && init?.method === "POST") return { ok: true, json: async () => ({ ok: true, sessionId: "created" }) };
        if (url === "/api/mobile/terminal-sessions") {
          sessionsCall += 1;
          const rows =
            sessionsCall === 1
              ? [session({ id: "a", cwd: "/repo/a", live: true })]
              : [
                  session({ id: "a", cwd: "/repo/a", live: true }),
                  session({ id: "other-new", cwd: "/repo/other", title: "other-new", live: true }),
                  session({ id: "created", cwd: "/repo/b", title: "created", live: true }),
                ];
          return { ok: true, json: async () => ({ sessions: rows }) };
        }
        if (url === "/api/mobile/terminal-sessions/a/screen") return { ok: true, json: async () => ({ screen: "screen-a" }) };
        if (url === "/api/mobile/terminal-sessions/created/screen") return { ok: true, json: async () => ({ screen: "screen-created" }) };
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      const wrapper = await mountPage();
      await cwdInput(wrapper).setValue("/repo/b");
      await findButton(wrapper, "Start").trigger("click");
      await flushPromises();

      expect(wrapper.get('[class*="border-accent"]').text()).toContain("created");
      expect(wrapper.get('[class*="border-accent"]').text()).not.toContain("other-new");
    });

    it("disables Start and ignores a second click while creation is in flight", async () => {
      let resolveCreate: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
      const deferredCreate = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
        resolveCreate = resolve;
      });
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
        if (url === "/api/mobile/terminal-sessions" && init?.method === "POST") return deferredCreate;
        if (url === "/api/mobile/terminal-sessions") return { ok: true, json: async () => ({ sessions: [session({ id: "a", cwd: "/repo/a", live: true })] }) };
        if (url === "/api/mobile/terminal-sessions/a/screen") return { ok: true, json: async () => ({ screen: "screen-a" }) };
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      const wrapper = await mountPage();
      await findButton(wrapper, "Start").trigger("click");
      await flushPromises();

      expect(findButton(wrapper, "Starting…").attributes("disabled")).toBeDefined();
      await findButton(wrapper, "Starting…").trigger("click");
      const createCalls = vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(([url, init]) => String(url) === "/api/mobile/terminal-sessions" && init?.method === "POST");
      expect(createCalls).toHaveLength(1);

      resolveCreate({ ok: true, json: async () => ({ ok: true, sessionId: "a" }) });
      await flushPromises();
    });

    it("locks Start before waiting for an in-flight session-list refresh", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      try {
        mockFetch({ mode: "local", sessions: [session({ id: "a", cwd: "/repo/a", live: true })], screens: { a: screenOk("hello") } });
        const wrapper = await mountPage();
        let resolveList: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
        const deferredList = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
          resolveList = resolve;
        });
        let firstListAfterReset = true;
        globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url === "/api/mobile/terminal-sessions" && init?.method !== "POST") {
            if (firstListAfterReset) {
              firstListAfterReset = false;
              return deferredList;
            }
            return { ok: true, json: async () => ({ sessions: [session({ id: "a", cwd: "/repo/a", live: true })] }) };
          }
          if (url === "/api/mobile/terminal-sessions" && init?.method === "POST") return { ok: true, json: async () => ({ ok: true, sessionId: "a" }) };
          if (url === "/api/mobile/terminal-sessions/a/screen") return { ok: true, json: async () => ({ screen: "hello" }) };
          throw new Error(`unexpected fetch: ${url}`);
        }) as unknown as typeof fetch;

        fireVisibilityChange("visible");
        await flushPromises();
        await findButton(wrapper, "Start").trigger("click");
        await flushPromises();
        await findButton(wrapper, "Starting…").trigger("click");
        expect(
          vi.mocked(globalThis.fetch).mock.calls.filter(([url, init]) => String(url) === "/api/mobile/terminal-sessions" && init?.method === "POST"),
        ).toHaveLength(0);

        resolveList({ ok: true, json: async () => ({ sessions: [session({ id: "a", cwd: "/repo/a", live: true })] }) });
        await flushPromises();
        vi.advanceTimersByTime(10);
        await flushPromises();

        expect(
          vi.mocked(globalThis.fetch).mock.calls.filter(([url, init]) => String(url) === "/api/mobile/terminal-sessions" && init?.method === "POST"),
        ).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("shows a create error and can retry with the same inputs", async () => {
      mockFetch({
        mode: "local",
        sessions: [session({ id: "a", cwd: "/repo/a", live: true })],
        screens: { a: screenOk("hello") },
        create: createFail(409, { error: "no MulmoTerminal browser is open" }),
      });
      const wrapper = await mountPage();
      await cwdInput(wrapper).setValue("/repo/a");
      await findButton(wrapper, "Start").trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain("no MulmoTerminal browser is open");

      mockFetch({
        mode: "local",
        sessions: [session({ id: "a", cwd: "/repo/a", live: true }), session({ id: "created", cwd: "/repo/a", live: true })],
        screens: { a: screenOk("hello"), created: screenOk("created screen") },
        create: createOk(),
      });
      await findButton(wrapper, "Start").trigger("click");
      await flushPromises();
      expect(wrapper.text()).not.toContain("no MulmoTerminal browser is open");
      expect(wrapper.get('[class*="border-accent"]').text()).toContain("created");
    });

    it("validates an empty cwd locally before POSTing", async () => {
      mockFetch({ mode: "local", sessions: [] });
      const wrapper = await mountPage();
      await cwdInput(wrapper).setValue(" ");
      await findButton(wrapper, "Start").trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain("Working directory is required.");
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url) === "/api/mobile/terminal-sessions" && init?.method === "POST")).toBe(
        false,
      );
    });
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

  describe("mobile web push", () => {
    it("shows unsupported notification state without hiding the local empty state", async () => {
      mockFetch({ mode: "local", sessions: [] });
      const wrapper = await mountPage();

      expect(wrapper.get('[data-testid="mobile-web-push-panel"]').text()).toContain("Unsupported");
      expect(wrapper.text()).toContain("Service Worker is not available");
      expect(wrapper.text()).toContain("No terminal sessions.");
    });

    it("requests permission from the Enable button and creates a subscription", async () => {
      const webPush = mockWebPush({ permission: "default", requestPermission: "granted", existingSubscription: null });
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("screen-a") } });
      const wrapper = await mountPage();

      await findButton(wrapper, "Enable").trigger("click");
      await flushPromises();

      expect(webPush.notification.requestPermission).toHaveBeenCalledTimes(1);
      expect(navigator.serviceWorker.register).toHaveBeenCalledWith("/mobile-web-push-sw.js", { scope: "/" });
      expect(webPush.registration.pushManager.subscribe).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      });
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/mobile/web-push/subscriptions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ subscription: { endpoint: "https://push.example/subscription", keys: { p256dh: "p256dh", auth: "auth" } } }),
        }),
      );
      expect(wrapper.get('[data-testid="mobile-web-push-panel"]').text()).toContain("Allowed");
      expect(wrapper.get('[data-testid="mobile-web-push-panel"]').text()).toContain("Active");
      expect(wrapper.text()).toContain("Subscription registered for server push.");
    });

    it("does not subscribe when notification permission is denied", async () => {
      const webPush = mockWebPush({ permission: "default", requestPermission: "denied", existingSubscription: null });
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("screen-a") } });
      const wrapper = await mountPage();

      await findButton(wrapper, "Enable").trigger("click");
      await flushPromises();

      expect(webPush.registration.pushManager.subscribe).not.toHaveBeenCalled();
      expect(wrapper.get('[data-testid="mobile-web-push-panel"]').text()).toContain("Blocked");
      expect(wrapper.text()).toContain("Notifications are blocked in this browser.");
    });

    it("shows a safe error when Push API subscription fails", async () => {
      mockWebPush({ permission: "granted", existingSubscription: null, subscribeFails: true });
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("screen-a") } });
      const wrapper = await mountPage();

      await findButton(wrapper, "Enable").trigger("click");
      await flushPromises();

      expect(wrapper.get('[data-testid="mobile-web-push-panel"]').text()).toContain("Needs attention");
      expect(wrapper.text()).toContain("Failed to register notifications with the server.");
    });

    it("unsubscribes an existing PushSubscription", async () => {
      const webPush = mockWebPush({ permission: "granted" });
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("screen-a") } });
      const wrapper = await mountPage();

      await findButton(wrapper, "Disable").trigger("click");
      await flushPromises();

      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/mobile/web-push/subscriptions",
        expect.objectContaining({ method: "DELETE", body: JSON.stringify({ endpoint: "https://push.example/subscription" }) }),
      );
      expect(webPush.subscription.unsubscribe).toHaveBeenCalled();
      expect(wrapper.get('[data-testid="mobile-web-push-panel"]').text()).toContain("Off");
    });

    it("sends a server-side test notification for the selected mobile session", async () => {
      const webPush = mockWebPush({ permission: "granted" });
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("screen-a") } });
      const wrapper = await mountPage();

      await findButton(wrapper, "Test notification").trigger("click");
      await flushPromises();

      expect(webPush.registration.showNotification).not.toHaveBeenCalled();
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/mobile/web-push/test",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ sessionId: "a" }) }),
      );
    });

    it("disables server push controls when the server has no VAPID config", async () => {
      mockWebPush({ permission: "granted", existingSubscription: null });
      mockFetch({
        mode: "local",
        sessions: [],
        webPushConfig: webPushOk({ enabled: false, publicKey: null, reason: "missing VAPID config" }),
      });
      const wrapper = await mountPage();

      expect(wrapper.get('[data-testid="mobile-web-push-panel"]').text()).toContain("Unsupported");
      expect(wrapper.text()).toContain("missing VAPID config");
      expect(findButton(wrapper, "Enable").attributes("disabled")).toBeDefined();
    });

    it("selects a session from the sessionId query parameter", async () => {
      await router.push("/mobile/terminals?sessionId=b");
      mockFetch({
        mode: "local",
        sessions: [session({ id: "a", live: true }), session({ id: "b", live: true })],
        screens: { a: screenOk("screen-a"), b: screenOk("screen-b") },
      });

      const wrapper = await mountPage();

      expect(wrapper.get('[class*="border-accent"]').text()).toContain("b");
      expect(wrapper.text()).toContain("screen-b");
    });
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

    // #7: ANSI colour/style on /mobile/terminals. `screenOk`/`screenResponse` above only ever
    // send `{ screen }` — these tests mock the response directly to add `styledScreen`, the
    // field these behaviours hang off (server/routes/local-mobile-terminal-routes.ts).
    describe("styled (ANSI) screen", () => {
      function mockScreenWith(styledScreen: unknown, screen = "fallback text") {
        globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
          if (url === "/api/mobile/terminal-sessions") return { ok: true, json: async () => ({ sessions: [session({ id: "a", live: true })] }) };
          if (url === "/api/mobile/terminal-sessions/a/screen") return { ok: true, json: async () => ({ screen, styledScreen }) };
          throw new Error(`unexpected fetch: ${url}`);
        }) as unknown as typeof fetch;
      }

      it("renders a coloured segment as a styled span, not as visible ANSI codes", async () => {
        mockScreenWith([[{ text: "red text", fg: "#e06c75", bg: null, bold: false }]]);
        const wrapper = await mountPage();

        const span = wrapper.find("pre span");
        expect(span.exists()).toBe(true);
        expect(span.text()).toBe("red text");
        expect((span.element as HTMLElement).style.color).toBe("rgb(224, 108, 117)");
        // The raw escape byte must never reach the rendered text.
        expect(wrapper.text()).not.toContain(String.fromCharCode(0x1b));
        expect(wrapper.text()).not.toContain("[31m");
      });

      it("applies a background colour and bold alongside the foreground", async () => {
        mockScreenWith([[{ text: "warn", fg: "#e5c07b", bg: "#545862", bold: true }]]);
        const wrapper = await mountPage();

        const span = wrapper.find("pre span");
        const style = (span.element as HTMLElement).style;
        expect(style.color).toBe("rgb(229, 192, 123)");
        expect(style.backgroundColor).toBe("rgb(84, 88, 98)");
        expect(style.fontWeight).toBe("700");
      });

      it("does not leak style into a later, unstyled segment (reset)", async () => {
        mockScreenWith([
          [
            { text: "red", fg: "#e06c75", bg: null, bold: false },
            { text: " plain", fg: null, bg: null, bold: false },
          ],
        ]);
        const wrapper = await mountPage();

        const spans = wrapper.findAll("pre span");
        expect(spans).toHaveLength(2);
        expect((spans[0].element as HTMLElement).style.color).toBe("rgb(224, 108, 117)");
        expect((spans[1].element as HTMLElement).style.color).toBe("");
        expect((spans[1].element as HTMLElement).style.backgroundColor).toBe("");
        expect((spans[1].element as HTMLElement).style.fontWeight).toBe("");
      });

      it("keeps a plain, colourless row readable as plain text", async () => {
        mockScreenWith([[{ text: "no colour here", fg: null, bg: null, bold: false }]]);
        const wrapper = await mountPage();
        expect(wrapper.find("pre").text()).toBe("no colour here");
      });

      it("escapes an HTML/script-looking segment as text, never as markup", async () => {
        mockScreenWith([[{ text: "<script>alert(1)</script>", fg: "#e06c75", bg: null, bold: false }]]);
        const wrapper = await mountPage();

        expect(wrapper.find("pre script").exists()).toBe(false);
        expect(wrapper.find("pre span").text()).toBe("<script>alert(1)</script>");
        expect(wrapper.html()).not.toContain("<script>alert(1)</script>");
      });

      it("keeps each row on its own line, including a blank row in the middle", async () => {
        mockScreenWith([[{ text: "first", fg: null, bg: null, bold: false }], [], [{ text: "third", fg: null, bg: null, bold: false }]]);
        const wrapper = await mountPage();

        const pre = wrapper.find("pre");
        const rows = pre.findAll("div");
        expect(rows).toHaveLength(3);
        expect(rows[0].text()).toBe("first");
        expect(rows[2].text()).toBe("third");
      });

      // An empty <div> has no line box and collapses to zero height, so a blank terminal line
      // would otherwise silently disappear from the styled view even though the plain-text
      // fallback (a real "\n") keeps it — the blank row needs SOME content to hold its line.
      // An empty <div> has no line box and collapses to zero height, so a blank terminal line
      // would otherwise silently disappear from the styled view even though the plain-text
      // fallback (a real "\n") keeps it. `.text()` trims whitespace (including U+00A0, per
      // ECMA-262's WhiteSpace production), so this reads `element.textContent` directly rather
      // than through that trimming helper.
      it("keeps a blank row's line height instead of letting it collapse to nothing", async () => {
        mockScreenWith([[{ text: "first", fg: null, bg: null, bold: false }], [], [{ text: "third", fg: null, bg: null, bold: false }]]);
        const wrapper = await mountPage();

        const rows = wrapper.find("pre").findAll("div");
        expect(rows[1].element.textContent).toBe("\u00A0");
      });

      it("preserves long lines and horizontal scroll on the styled screen too", async () => {
        mockScreenWith([[{ text: "x".repeat(500), fg: "#61afef", bg: null, bold: false }]]);
        const wrapper = await mountPage();

        const pre = wrapper.find("pre");
        expect(pre.classes()).toContain("overflow-x-auto");
        expect(pre.classes()).toContain("whitespace-pre");
        expect(pre.text()).toBe("x".repeat(500));
      });

      it("falls back to the plain-text screen when the server sends no styledScreen at all", async () => {
        mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("plain fallback") } });
        const wrapper = await mountPage();
        const pre = wrapper.find("pre");
        expect(pre.find("span").exists()).toBe(false);
        expect(pre.text()).toBe("plain fallback");
      });

      it("treats a malformed styledScreen as an invalid response rather than guessing at it", async () => {
        // Not an array of rows of segments — isMobileScreen must reject the whole payload (the
        // same fail-loud rule this file already applies to a malformed session row) rather than
        // rendering something built from a shape nothing validated.
        mockScreenWith("not-an-array-of-rows");
        const wrapper = await mountPage();
        expect(wrapper.text()).toContain("Failed to load terminal screen.");
      });
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

  // Only setTimeout/clearTimeout are faked here (not setImmediate), because @vue/test-utils'
  // flushPromises() schedules its resolution via setImmediate and would hang under a full fake
  // timer set — see its implementation. The 5s cooldown is real setTimeout, which is what these
  // tests need control over.
  describe("manual screen refresh", () => {
    it("shows a Refresh button once the screen has loaded", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("hello") } });
      const wrapper = await mountPage();
      expect(wrapper.findAll("button").some((b) => b.text() === "Refresh")).toBe(true);
    });

    it("refetches the current session's screen, once, when Refresh is clicked", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
      const wrapper = await mountPage();

      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v2") } });
      const refreshButton = wrapper.findAll("button").find((b) => b.text() === "Refresh");
      await refreshButton?.trigger("click");
      await flushPromises();

      expect(vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input) === "/api/mobile/terminal-sessions/a/screen")).toHaveLength(1);
      expect(wrapper.text()).toContain("v2");
    });

    it("does not refetch the mode or the session list when Refresh is clicked", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
      const wrapper = await mountPage();

      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v2") } });
      const refreshButton = wrapper.findAll("button").find((b) => b.text() === "Refresh");
      await refreshButton?.trigger("click");
      await flushPromises();

      expect(globalThis.fetch).not.toHaveBeenCalledWith("/api/mobile-mode");
      expect(globalThis.fetch).not.toHaveBeenCalledWith("/api/mobile/terminal-sessions");
    });

    it("disables Refresh while the screen is loading", async () => {
      let resolveScreen: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
      const deferredScreen = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
        resolveScreen = resolve;
      });

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
        if (url === "/api/mobile/terminal-sessions") return { ok: true, json: async () => ({ sessions: [session({ id: "a", live: true })] }) };
        if (url === "/api/mobile/terminal-sessions/a/screen") return deferredScreen;
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      const wrapper = mount(MobileTerminalPage, { global: { plugins: [router] } });
      await flushPromises();
      // Mode and the session list have resolved; the initial screen fetch is still pending.
      const refreshButton = wrapper.findAll("button").find((b) => b.text() === "Refresh");
      expect(refreshButton?.attributes("disabled")).toBeDefined();

      resolveScreen({ ok: true, json: async () => ({ screen: "hello" }) });
      await flushPromises();
    });

    it("ignores a second manual refresh within the 5s cooldown", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
        const wrapper = await mountPage();
        const refreshButton = () => findButton(wrapper, "Refresh");

        await refreshButton().trigger("click"); // starts the cooldown
        await flushPromises();
        vi.advanceTimersByTime(4000); // still within the 5s window

        await refreshButton().trigger("click");
        await flushPromises();

        // The initial load's screen fetch, plus the one Refresh that started the cooldown — the
        // second click, inside the cooldown, adds none.
        expect(screenCallCount("a")).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("allows another manual refresh once the 5s cooldown has elapsed", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
        const wrapper = await mountPage();
        const refreshButton = () => findButton(wrapper, "Refresh");

        await refreshButton().trigger("click");
        await flushPromises();
        vi.advanceTimersByTime(5000);
        // The cooldown ref flips synchronously inside the timer callback, but Vue patches the
        // button's `disabled` attribute asynchronously — without this, trigger("click") below
        // would hit a still-disabled real DOM button and silently do nothing.
        await nextTick();

        await refreshButton().trigger("click");
        await flushPromises();

        expect(screenCallCount("a")).toBe(3); // initial load + two manual refreshes
      } finally {
        vi.useRealTimers();
      }
    });

    it("shares the cooldown between the manual Refresh button and the screen error's Retry button", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenFail(500) } });
        const wrapper = await mountPage();
        expect(wrapper.text()).toContain("Failed to load terminal screen.");

        const retryButton = () => findButton(wrapper, "Retry");
        await retryButton().trigger("click"); // starts the cooldown
        await flushPromises();
        vi.advanceTimersByTime(1000);

        await retryButton().trigger("click"); // still within the cooldown
        await flushPromises();

        expect(screenCallCount("a")).toBe(2); // initial load's fetch, plus the one Retry that started the cooldown
      } finally {
        vi.useRealTimers();
      }
    });

    it("still fetches a newly selected session's screen immediately during a manual-refresh cooldown", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        mockFetch({
          mode: "local",
          sessions: [session({ id: "a", live: true }), session({ id: "b", live: false })],
          screens: { a: screenOk("screen-a"), b: screenOk("screen-b") },
        });
        const wrapper = await mountPage();

        const refreshButton = wrapper.findAll("button").find((b) => b.text() === "Refresh");
        await refreshButton?.trigger("click"); // starts the cooldown, still active below
        await flushPromises();

        const buttons = wrapper.findAll("main li button");
        await buttons[1].trigger("click"); // select "b" while the cooldown is active
        await flushPromises();

        expect(screenCallCount("b")).toBe(1);
        expect(wrapper.text()).toContain("screen-b");
      } finally {
        vi.useRealTimers();
      }
    });

    it("clears the cooldown timeout on unmount", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
        const wrapper = await mountPage();

        const refreshButton = wrapper.findAll("button").find((b) => b.text() === "Refresh");
        await refreshButton?.trigger("click"); // starts the cooldown timeout
        await flushPromises();

        const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
        wrapper.unmount();

        expect(clearTimeoutSpy).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("screen refresh on resume", () => {
    it("does not fetch a screen for a hidden visibilitychange", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
      await mountPage();

      fireVisibilityChange("hidden");
      await flushPromises();

      expect(screenCallCount("a")).toBe(1); // only the initial load's fetch
    });

    it("fetches the selected session's screen once when the tab becomes visible", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
      await mountPage();

      fireVisibilityChange("visible");
      await flushPromises();

      expect(screenCallCount("a")).toBe(2); // the initial load's fetch, plus one on resume
    });

    it("does not refetch the mode check when the tab becomes visible, but does refresh the session list", async () => {
      // The session list refresh on resume is what keeps activity current after a phone was
      // locked — see the "session activity" describe block below for its own dedicated coverage.
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
      await mountPage();

      fireVisibilityChange("visible");
      await flushPromises();

      const modeCalls = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input) === "/api/mobile-mode");
      const sessionsCalls = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input) === "/api/mobile/terminal-sessions");
      expect(modeCalls).toHaveLength(1);
      expect(sessionsCalls).toHaveLength(2); // the initial load, plus one on resume
    });

    it("does not fetch a screen on resume in remote mode", async () => {
      mockFetch({ mode: "remote" });
      await mountPage();

      fireVisibilityChange("visible");
      await flushPromises();

      expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/\/screen$/));
    });

    it("does not fetch a screen on resume when there are no sessions", async () => {
      mockFetch({ mode: "local", sessions: [] });
      await mountPage();

      fireVisibilityChange("visible");
      await flushPromises();

      expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/\/screen$/));
    });

    it("does not add a screen request on resume while one is already loading", async () => {
      let resolveScreen: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
      const deferredScreen = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
        resolveScreen = resolve;
      });

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
        if (url === "/api/mobile/terminal-sessions") return { ok: true, json: async () => ({ sessions: [session({ id: "a", live: true })] }) };
        if (url === "/api/mobile/terminal-sessions/a/screen") return deferredScreen;
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      const wrapper = mount(MobileTerminalPage, { global: { plugins: [router] } });
      await flushPromises();
      // The initial screen fetch is still pending ("loading").

      fireVisibilityChange("visible");
      await flushPromises();

      expect(screenCallCount("a")).toBe(1); // the still-pending initial fetch only — no second one added
      expect(wrapper.text()).toContain("Loading terminal screen…");

      resolveScreen({ ok: true, json: async () => ({ screen: "hello" }) });
      await flushPromises();
    });

    it("recovers from a screen error when the tab becomes visible again", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenFail(500) } });
      const wrapper = await mountPage();
      expect(wrapper.text()).toContain("Failed to load terminal screen.");

      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("recovered") } });
      fireVisibilityChange("visible");
      await flushPromises();

      expect(wrapper.text()).toContain("recovered");
    });

    it("still fetches on resume during a manual-refresh cooldown, once the refresh request has settled", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
        const wrapper = await mountPage();

        const refreshButton = findButton(wrapper, "Refresh");
        await refreshButton.trigger("click"); // starts the cooldown; the mocked request settles immediately
        await flushPromises();

        fireVisibilityChange("visible"); // must fire even though the cooldown is still running
        await flushPromises();

        expect(screenCallCount("a")).toBe(3); // initial load + the manual refresh + the resume fetch
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not start the manual-refresh cooldown from a resume fetch", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
        const wrapper = await mountPage();

        fireVisibilityChange("visible");
        await flushPromises();

        // If the resume fetch had started the manual-refresh cooldown, Refresh would still be
        // disabled here and the click below would silently do nothing.
        const refreshButton = findButton(wrapper, "Refresh");
        expect(refreshButton.attributes("disabled")).toBeUndefined();

        await refreshButton.trigger("click");
        await flushPromises();

        expect(screenCallCount("a")).toBe(3); // initial load + the resume fetch + the manual refresh
      } finally {
        vi.useRealTimers();
      }
    });

    it("removes the visibilitychange listener on unmount", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
      const wrapper = await mountPage();

      const removeSpy = vi.spyOn(document, "removeEventListener");
      wrapper.unmount();

      expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
      removeSpy.mockRestore();
    });
  });

  describe("terminal input", () => {
    function inputEl(wrapper: Awaited<ReturnType<typeof mountPage>>) {
      return wrapper.find('footer input[type="text"]');
    }

    function inputCallCount(id: string): number {
      return vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === `/api/mobile/terminal-sessions/${id}/input`).length;
    }

    it("shows a one-line input and Send button for a live session once its screen has loaded", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("hello") } });
      const wrapper = await mountPage();
      expect(inputEl(wrapper).exists()).toBe(true);
      expect(wrapper.findAll("button").some((b) => b.text() === "Send")).toBe(true);
    });

    it("does not show the input form for a detached session", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: false })], screens: { a: screenOk("hello") } });
      const wrapper = await mountPage();
      expect(inputEl(wrapper).exists()).toBe(false);
      expect(wrapper.text()).toContain("Detached sessions are read-only.");
    });

    it("does not show the input form while the screen is loading", async () => {
      let resolveScreen: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
      const deferredScreen = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
        resolveScreen = resolve;
      });

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
        if (url === "/api/mobile/terminal-sessions") return { ok: true, json: async () => ({ sessions: [session({ id: "a", live: true })] }) };
        if (url === "/api/mobile/terminal-sessions/a/screen") return deferredScreen;
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      const wrapper = mount(MobileTerminalPage, { global: { plugins: [router] } });
      await flushPromises();
      expect(inputEl(wrapper).exists()).toBe(false);

      resolveScreen({ ok: true, json: async () => ({ screen: "hello" }) });
      await flushPromises();
    });

    it("does not show the input form when the screen failed to load", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenFail(500) } });
      const wrapper = await mountPage();
      expect(inputEl(wrapper).exists()).toBe(false);
    });

    it("does not show the input form in remote mode", async () => {
      mockFetch({ mode: "remote" });
      const wrapper = await mountPage();
      expect(inputEl(wrapper).exists()).toBe(false);
    });

    it("POSTs the typed text, unmodified, to the session's input endpoint with a JSON content type", async () => {
      mockFetch({
        mode: "local",
        sessions: [session({ id: "id with space", live: true })],
        screens: { "id with space": screenOk("hello") },
        inputs: { "id with space": inputOk() },
      });
      const wrapper = await mountPage();

      await inputEl(wrapper).setValue("  echo hi  ");
      await wrapper.find("form").trigger("submit");
      await flushPromises();

      // encodeURIComponent applied to the session id in the URL.
      const call = vi.mocked(globalThis.fetch).mock.calls.find(([url]) => String(url) === "/api/mobile/terminal-sessions/id%20with%20space/input");
      if (!call) throw new Error("input POST not found");
      const [, init] = call;
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
      // The original string, not the trimmed one — trimming only decides whether to send at all.
      expect(init?.body).toBe(JSON.stringify({ text: "  echo hi  " }));
    });

    it("clears the input after a successful send", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("hello") }, inputs: { a: inputOk() } });
      const wrapper = await mountPage();

      await inputEl(wrapper).setValue("echo hi");
      await wrapper.find("form").trigger("submit");
      await flushPromises();

      expect((inputEl(wrapper).element as HTMLInputElement).value).toBe("");
    });

    it("shows a fixed error message and keeps the input on a non-2xx response", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("hello") }, inputs: { a: inputFail(500) } });
      const wrapper = await mountPage();

      await inputEl(wrapper).setValue("echo hi");
      await wrapper.find("form").trigger("submit");
      await flushPromises();

      expect(wrapper.text()).toContain("Failed to send terminal input.");
      expect((inputEl(wrapper).element as HTMLInputElement).value).toBe("echo hi");
    });

    it("shows the fixed error message and keeps the input when the response's sent field is not true", async () => {
      mockFetch({
        mode: "local",
        sessions: [session({ id: "a", live: true })],
        screens: { a: screenOk("hello") },
        inputs: { a: inputBadBody({ sent: false }) },
      });
      const wrapper = await mountPage();

      await inputEl(wrapper).setValue("echo hi");
      await wrapper.find("form").trigger("submit");
      await flushPromises();

      expect(wrapper.text()).toContain("Failed to send terminal input.");
      expect((inputEl(wrapper).element as HTMLInputElement).value).toBe("echo hi");
    });

    it("disables the input and Send button while sending, and ignores an extra submit meanwhile", async () => {
      let resolveInput: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
      const deferredInput = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
        resolveInput = resolve;
      });

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
        if (url === "/api/mobile/terminal-sessions") return { ok: true, json: async () => ({ sessions: [session({ id: "a", live: true })] }) };
        if (url === "/api/mobile/terminal-sessions/a/screen") return { ok: true, json: async () => ({ screen: "hello" }) };
        if (url === "/api/mobile/terminal-sessions/a/input") return deferredInput;
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      const wrapper = mount(MobileTerminalPage, { global: { plugins: [router] } });
      await flushPromises();

      await inputEl(wrapper).setValue("echo hi");
      await wrapper.find("form").trigger("submit");
      await wrapper.find("form").trigger("submit"); // a second submit while the first is still in flight
      await flushPromises();

      expect(inputEl(wrapper).attributes("disabled")).toBeDefined();
      expect(findButton(wrapper, "Send").attributes("disabled")).toBeDefined();
      expect(inputCallCount("a")).toBe(1); // the second submit added no request

      resolveInput({ ok: true, json: async () => ({ sent: true }) });
      await flushPromises();
    });

    it("does not POST for empty or whitespace-only input", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("hello") }, inputs: { a: inputOk() } });
      const wrapper = await mountPage();

      await inputEl(wrapper).setValue("   ");
      await wrapper.find("form").trigger("submit");
      await flushPromises();

      expect(inputCallCount("a")).toBe(0);
    });

    it("can resend the same text after a failed send", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("hello") }, inputs: { a: inputFail(500) } });
      const wrapper = await mountPage();

      await inputEl(wrapper).setValue("echo hi");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      expect(wrapper.text()).toContain("Failed to send terminal input.");

      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("hello") }, inputs: { a: inputOk() } });
      await wrapper.find("form").trigger("submit"); // the box still holds the same text
      await flushPromises();

      expect((inputEl(wrapper).element as HTMLInputElement).value).toBe("");
      expect(wrapper.text()).not.toContain("Failed to send terminal input.");
    });

    it("does not refetch the screen after a successful send", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("hello") }, inputs: { a: inputOk() } });
      const wrapper = await mountPage();

      await inputEl(wrapper).setValue("echo hi");
      await wrapper.find("form").trigger("submit");
      await flushPromises();

      expect(screenCallCount("a")).toBe(1); // only the initial load's fetch
    });

    it("does not refetch the mode or the session list after a successful send", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("hello") }, inputs: { a: inputOk() } });
      const wrapper = await mountPage();

      await inputEl(wrapper).setValue("echo hi");
      await wrapper.find("form").trigger("submit");
      await flushPromises();

      const modeCalls = vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === "/api/mobile-mode");
      const sessionsCalls = vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === "/api/mobile/terminal-sessions");
      expect(modeCalls).toHaveLength(1);
      expect(sessionsCalls).toHaveLength(1);
    });

    it("clears the input text and any input error when switching sessions", async () => {
      mockFetch({
        mode: "local",
        sessions: [session({ id: "a", live: true }), session({ id: "b", live: true })],
        screens: { a: screenOk("screen-a"), b: screenOk("screen-b") },
        inputs: { a: inputFail(500) },
      });
      const wrapper = await mountPage();

      await inputEl(wrapper).setValue("echo hi");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      expect(wrapper.text()).toContain("Failed to send terminal input.");

      const buttons = wrapper.findAll("main li button");
      await buttons[1].trigger("click"); // switch to "b"
      await flushPromises();

      expect((inputEl(wrapper).element as HTMLInputElement).value).toBe("");
      expect(wrapper.text()).not.toContain("Failed to send terminal input.");
    });

    it("does not let a stale send response from session A affect session B's input state", async () => {
      let resolveInputA: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
      const deferredInputA = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
        resolveInputA = resolve;
      });

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
        if (url === "/api/mobile/terminal-sessions")
          return { ok: true, json: async () => ({ sessions: [session({ id: "a", live: true }), session({ id: "b", live: true })] }) };
        if (url === "/api/mobile/terminal-sessions/a/screen") return { ok: true, json: async () => ({ screen: "screen-a" }) };
        if (url === "/api/mobile/terminal-sessions/b/screen") return { ok: true, json: async () => ({ screen: "screen-b" }) };
        if (url === "/api/mobile/terminal-sessions/a/input") return deferredInputA;
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      const wrapper = mount(MobileTerminalPage, { global: { plugins: [router] } });
      await flushPromises();
      // Initial selection is "a" (the first live session).

      await inputEl(wrapper).setValue("echo from a");
      await wrapper.find("form").trigger("submit"); // A's send is now pending
      await flushPromises();

      const buttons = wrapper.findAll("main li button");
      await buttons[1].trigger("click"); // switch to "b" while A's send is in flight
      await flushPromises();

      await inputEl(wrapper).setValue("echo from b");

      // A's response arrives late, as a failure — it must not clear B's typed text or show B an
      // error message that was never B's.
      resolveInputA({ ok: false, json: async () => ({}) });
      await flushPromises();

      expect((inputEl(wrapper).element as HTMLInputElement).value).toBe("echo from b");
      expect(wrapper.text()).not.toContain("Failed to send terminal input.");
    });
  });

  // The page is a fixed-viewport-height, three-band layout (header / scrollable main / fixed
  // input footer) rather than a page that grows past the screen and relies on the browser's own
  // scroll — see the component's own comments for why. These checks pin the load-bearing classes
  // and the DOM relationship (form outside main, inside footer) without asserting on the full
  // class string, so unrelated styling tweaks don't make this brittle.
  describe("mobile layout", () => {
    it("pins the root element to the dynamic viewport height and clips overflow", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
      const wrapper = await mountPage();
      const root = wrapper.element as HTMLElement;
      expect(root.className).toContain("h-dvh");
      expect(root.className).toContain("overflow-hidden");
    });

    it("makes main the scrollable region, not the page", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
      const wrapper = await mountPage();
      const main = wrapper.find("main");
      expect(main.exists()).toBe(true);
      expect(main.classes()).toContain("min-h-0");
      expect(main.classes()).toContain("overflow-y-auto");
    });

    it("keeps the input form out of main and inside a footer", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
      const wrapper = await mountPage();

      const main = wrapper.find("main");
      expect(main.find("form").exists()).toBe(false);

      const footer = wrapper.find("footer");
      expect(footer.exists()).toBe(true);
      expect(footer.find("form").exists()).toBe(true);
      expect(footer.find('input[type="text"]').exists()).toBe(true);
    });

    it("keeps the detached-session read-only notice inside the scrollable main, not the footer", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: false })], screens: { a: screenOk("v1") } });
      const wrapper = await mountPage();

      const main = wrapper.find("main");
      expect(main.text()).toContain("Detached sessions are read-only.");
      expect(wrapper.find("footer").exists()).toBe(false);
    });

    it("scrolls the terminal screen horizontally only, leaving vertical scrolling to main", async () => {
      mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("line1\nline2") } });
      const wrapper = await mountPage();
      const pre = wrapper.find("pre");
      expect(pre.exists()).toBe(true);
      expect(pre.classes()).toContain("overflow-x-auto");
      // No independent vertical scroll/fixed-height class on <pre> itself — main owns that axis.
      expect(pre.classes()).not.toContain("overflow-y-auto");
    });

    describe("footer visibility", () => {
      it("shows the footer for a live session once its screen has loaded", async () => {
        mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenOk("v1") } });
        const wrapper = await mountPage();
        expect(wrapper.find("footer").exists()).toBe(true);
      });

      it("hides the footer for a detached session", async () => {
        mockFetch({ mode: "local", sessions: [session({ id: "a", live: false })], screens: { a: screenOk("v1") } });
        const wrapper = await mountPage();
        expect(wrapper.find("footer").exists()).toBe(false);
      });

      it("hides the footer while the screen is loading", async () => {
        let resolveScreen: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
        const deferredScreen = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
          resolveScreen = resolve;
        });

        globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === "/api/mobile-mode") return { ok: true, json: async () => ({ mode: "local" }) };
          if (url === "/api/mobile/terminal-sessions") return { ok: true, json: async () => ({ sessions: [session({ id: "a", live: true })] }) };
          if (url === "/api/mobile/terminal-sessions/a/screen") return deferredScreen;
          throw new Error(`unexpected fetch: ${url}`);
        }) as unknown as typeof fetch;

        const wrapper = mount(MobileTerminalPage, { global: { plugins: [router] } });
        await flushPromises();
        expect(wrapper.find("footer").exists()).toBe(false);

        resolveScreen({ ok: true, json: async () => ({ screen: "hello" }) });
        await flushPromises();
      });

      it("hides the footer when the screen failed to load", async () => {
        mockFetch({ mode: "local", sessions: [session({ id: "a", live: true })], screens: { a: screenFail(500) } });
        const wrapper = await mountPage();
        expect(wrapper.find("footer").exists()).toBe(false);
      });

      it("hides the footer when there are no sessions", async () => {
        mockFetch({ mode: "local", sessions: [] });
        const wrapper = await mountPage();
        expect(wrapper.find("footer").exists()).toBe(false);
      });

      it("hides the footer in remote mode", async () => {
        mockFetch({ mode: "remote" });
        const wrapper = await mountPage();
        expect(wrapper.find("footer").exists()).toBe(false);
      });
    });
  });
});
