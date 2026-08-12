// @vitest-environment node
import webPush from "web-push";
import type { SendResult } from "web-push";
import { describe, expect, it, vi } from "vitest";
import { createMobileWebPushSender, buildMobileWebPushPayload } from "../../../server/mobile-web-push/sender";
import type { MobileWebPushConfig } from "../../../server/mobile-web-push/config";
import type { MobileWebPushSubscription, MobileWebPushSubscriptionStore } from "../../../server/mobile-web-push/subscription-store";

const CONFIG: MobileWebPushConfig = {
  enabled: true,
  vapid: { subject: "mailto:push@example.test", publicKey: "public-key", privateKey: "private-key" },
};

const stored = (endpoint: string, expirationTime: number | null = null): MobileWebPushSubscription => ({
  endpoint,
  expirationTime,
  keys: { p256dh: "p256dh", auth: "auth" },
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
});

function storeFor(subscriptions: MobileWebPushSubscription[]): MobileWebPushSubscriptionStore & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    list: async () => subscriptions.filter((entry) => !removed.includes(entry.endpoint)),
    upsert: async () => ({ created: true, count: subscriptions.length }),
    removeEndpoint: async (endpoint) => {
      removed.push(endpoint);
      return { removed: true, count: subscriptions.length - removed.length };
    },
    removeEndpoints: async (endpoints) => {
      removed.push(...endpoints);
      return { removed: endpoints.length, count: subscriptions.length - removed.length };
    },
  };
}

describe("buildMobileWebPushPayload", () => {
  it("keeps test payload minimal and routes to the selected mobile session", () => {
    expect(buildMobileWebPushPayload("test", "session-a")).toEqual({
      kind: "test",
      sessionId: "session-a",
      agent: null,
      url: "/mobile/terminals?sessionId=session-a",
    });
  });

  it("keeps activity payloads minimal and routes to the target session", () => {
    expect(buildMobileWebPushPayload("waiting", "session-a", "codex")).toEqual({
      kind: "waiting",
      sessionId: "session-a",
      agent: "codex",
      url: "/mobile/terminals?sessionId=session-a",
    });
    expect(buildMobileWebPushPayload("finished", "session-b", "claude")).toEqual({
      kind: "finished",
      sessionId: "session-b",
      agent: "claude",
      url: "/mobile/terminals?sessionId=session-b",
    });
  });

  it("uses the configured base path in server-built notification URLs", () => {
    expect(buildMobileWebPushPayload("test", "session-a", null, "/mulmoterminal/")).toEqual({
      kind: "test",
      sessionId: "session-a",
      agent: null,
      url: "/mulmoterminal/mobile/terminals?sessionId=session-a",
    });
  });
});

describe("createMobileWebPushSender", () => {
  it("does not send when VAPID config is missing", async () => {
    const send = vi.fn();
    const sender = createMobileWebPushSender({
      config: () => ({ enabled: false, reason: "missing" }),
      store: storeFor([stored("https://push.example/a")]),
      sendNotification: send,
    });

    expect(await sender.sendTest(null)).toEqual({ ok: false, reason: "missing" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the fixed test payload to every stored subscription", async () => {
    const send = vi.fn(async (...args: unknown[]): Promise<SendResult> => {
      expect(args.length).toBeGreaterThan(0);
      return { statusCode: 201, body: "", headers: {} };
    });
    const sender = createMobileWebPushSender({
      config: () => CONFIG,
      store: storeFor([stored("https://push.example/a"), stored("https://push.example/b")]),
      sendNotification: send as unknown as typeof import("web-push").sendNotification,
    });

    expect(await sender.sendTest("session-a")).toEqual({ ok: true, sent: 2, failed: 0, targets: 2, removed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(send.mock.calls[0]?.[1]))).toMatchObject({ kind: "test", sessionId: "session-a" });
    expect(send.mock.calls[0]?.[2]).toMatchObject({ vapidDetails: CONFIG.vapid, TTL: 300, urgency: "normal", topic: "mulmoterminal-mobile-test" });
  });

  it("sends activity notifications through the same stored subscriptions", async () => {
    const send = vi.fn(async (...args: unknown[]): Promise<SendResult> => {
      expect(args.length).toBeGreaterThan(0);
      return { statusCode: 201, body: "", headers: {} };
    });
    const sender = createMobileWebPushSender({
      config: () => CONFIG,
      store: storeFor([stored("https://push.example/a")]),
      sendNotification: send as unknown as typeof import("web-push").sendNotification,
    });

    expect(await sender.sendActivity("waiting", { sessionId: "session-a", agent: "codex" })).toEqual({
      ok: true,
      sent: 1,
      failed: 0,
      targets: 1,
      removed: 0,
    });
    expect(JSON.parse(String(send.mock.calls[0]?.[1]))).toMatchObject({
      kind: "waiting",
      sessionId: "session-a",
      agent: "codex",
      url: "/mobile/terminals?sessionId=session-a",
    });
    expect(send.mock.calls[0]?.[2]).not.toHaveProperty("topic");
  });

  it("removes expired subscriptions before sending", async () => {
    const store = storeFor([stored("https://push.example/expired", 100), stored("https://push.example/live", 300)]);
    const send = vi.fn(async (): Promise<SendResult> => ({ statusCode: 201, body: "", headers: {} }));
    const sender = createMobileWebPushSender({ config: () => CONFIG, store, sendNotification: send, now: () => 200 });

    expect(await sender.sendTest(null)).toEqual({ ok: true, sent: 1, failed: 0, targets: 1, removed: 1 });
    expect(store.removed).toEqual(["https://push.example/expired"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("removes subscriptions that the push service reports as gone", async () => {
    const store = storeFor([stored("https://push.example/gone")]);
    const send = vi.fn(async () => {
      throw new webPush.WebPushError("gone", 410, {}, "", "https://push.example/gone");
    });
    const sender = createMobileWebPushSender({ config: () => CONFIG, store, sendNotification: send });

    expect(await sender.sendTest(null)).toEqual({ ok: true, sent: 0, failed: 1, targets: 1, removed: 1 });
    expect(store.removed).toEqual(["https://push.example/gone"]);
  });
});
