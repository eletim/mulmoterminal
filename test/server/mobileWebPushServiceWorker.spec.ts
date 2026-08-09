import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type ServiceWorkerListener = (event: {
  data?: {
    json: () => unknown;
  };
  notification?: {
    data?: unknown;
    close: () => void;
  };
  waitUntil: (promise: Promise<unknown>) => void;
}) => void;
type MockWindowClient = {
  url: string;
  focus: () => Promise<undefined>;
  navigate?: (url: string) => Promise<undefined>;
};

function loadServiceWorker() {
  const listeners = new Map<string, ServiceWorkerListener>();
  const matchAll = vi.fn(async (): Promise<MockWindowClient[]> => []);
  const openWindow = vi.fn(async () => undefined);
  const self = {
    location: { origin: "https://app.example" },
    registration: {
      showNotification: vi.fn(async () => undefined),
    },
    clients: {
      matchAll,
      openWindow,
    },
    addEventListener: vi.fn((type: string, listener: ServiceWorkerListener) => {
      listeners.set(type, listener);
    }),
  };

  const source = readFileSync(resolve(process.cwd(), "public/mobile-web-push-sw.js"), "utf8");
  // eslint-disable-next-line sonarjs/code-eval -- evaluates the checked-in Service Worker file in a mocked worker global.
  vm.runInNewContext(source, { self, URL, URLSearchParams });

  const listener = (type: string): ServiceWorkerListener => {
    const found = listeners.get(type);
    if (!found) throw new Error(`missing listener: ${type}`);
    return found;
  };

  return { self, listener };
}

describe("mobile web push service worker", () => {
  it("shows the server-provided notification text and carries a session URL", async () => {
    const { self, listener } = loadServiceWorker();
    const waits: Promise<unknown>[] = [];

    listener("push")({
      data: { json: () => ({ kind: "test", sessionId: "session a" }) },
      waitUntil: (promise) => waits.push(promise),
    });
    await Promise.all(waits);

    expect(self.registration.showNotification).toHaveBeenCalledWith("MulmoTerminal test", {
      body: "Mobile notifications are working.",
      tag: "mulmoterminal-mobile-test-session a",
      data: { url: "/mobile/terminals?sessionId=session+a" },
    });
  });

  it("derives activity notification text from kind and agent without server-provided body text", async () => {
    const { self, listener } = loadServiceWorker();
    const waits: Promise<unknown>[] = [];

    listener("push")({
      data: { json: () => ({ kind: "waiting", sessionId: "session-a", agent: "codex", url: "/mobile/terminals?sessionId=session-a" }) },
      waitUntil: (promise) => waits.push(promise),
    });
    await Promise.all(waits);

    expect(self.registration.showNotification).toHaveBeenCalledWith("MulmoTerminal needs input", {
      body: "Codex is waiting.",
      data: { url: "/mobile/terminals?sessionId=session-a" },
    });
  });

  it("marks finished notifications as audible through the OS notification settings", async () => {
    const { self, listener } = loadServiceWorker();
    const waits: Promise<unknown>[] = [];

    listener("push")({
      data: { json: () => ({ kind: "finished", sessionId: "session-a", agent: "codex", url: "/mobile/terminals?sessionId=session-a" }) },
      waitUntil: (promise) => waits.push(promise),
    });
    await Promise.all(waits);

    expect(self.registration.showNotification).toHaveBeenCalledWith("MulmoTerminal done", {
      body: "Codex finished.",
      data: { url: "/mobile/terminals?sessionId=session-a" },
      silent: false,
    });
  });

  it("ignores cross-origin notification URLs", async () => {
    const { self, listener } = loadServiceWorker();
    const waits: Promise<unknown>[] = [];

    listener("push")({
      data: { json: () => ({ url: "https://evil.example/mobile/terminals?sessionId=a" }) },
      waitUntil: (promise) => waits.push(promise),
    });
    await Promise.all(waits);

    expect(self.registration.showNotification).toHaveBeenCalledWith("MulmoTerminal", expect.objectContaining({ data: { url: "/mobile/terminals" } }));
  });

  it("focuses an existing mobile terminals tab on notification click", async () => {
    const { self, listener } = loadServiceWorker();
    const focus = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    self.clients.matchAll.mockResolvedValue([{ url: "https://app.example/mobile/terminals", focus, navigate }]);
    const close = vi.fn();
    const waits: Promise<unknown>[] = [];

    listener("notificationclick")({
      notification: { data: { url: "/mobile/terminals?sessionId=a" }, close },
      waitUntil: (promise) => waits.push(promise),
    });
    await Promise.all(waits);

    expect(close).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/mobile/terminals?sessionId=a");
    expect(focus).toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("opens mobile terminals when no existing tab can be focused", async () => {
    const { self, listener } = loadServiceWorker();
    const waits: Promise<unknown>[] = [];

    listener("notificationclick")({
      notification: { data: { url: "/mobile/terminals?sessionId=a" }, close: vi.fn() },
      waitUntil: (promise) => waits.push(promise),
    });
    await Promise.all(waits);

    expect(self.clients.openWindow).toHaveBeenCalledWith("/mobile/terminals?sessionId=a");
  });
});
