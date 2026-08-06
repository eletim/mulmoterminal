import { WebPushError, sendNotification, type PushSubscription, type SendResult } from "web-push";
import type { MobileWebPushConfig } from "./config.js";
import type { MobileWebPushSubscriptionStore } from "./subscription-store.js";

export type MobileWebPushNotificationKind = "test";

export interface MobileWebPushPayload {
  title: string;
  body: string;
  kind: MobileWebPushNotificationKind;
  sessionId: string | null;
  url: string;
}

export type MobileWebPushSendResult =
  | {
      ok: true;
      sent: number;
      failed: number;
      targets: number;
      removed: number;
    }
  | {
      ok: false;
      reason: string;
    };

export interface MobileWebPushSender {
  sendTest(sessionId: string | null): Promise<MobileWebPushSendResult>;
}

export interface MobileWebPushSenderDeps {
  config: () => MobileWebPushConfig;
  store: MobileWebPushSubscriptionStore;
  sendNotification?: typeof sendNotification;
  now?: () => number;
}

export function mobileTerminalNotificationUrl(sessionId: string | null): string {
  if (!sessionId) return "/mobile/terminals";
  const params = new URLSearchParams({ sessionId });
  return `/mobile/terminals?${params.toString()}`;
}

export function buildMobileWebPushPayload(kind: MobileWebPushNotificationKind, sessionId: string | null): MobileWebPushPayload {
  return {
    title: "MulmoTerminal test",
    body: "Mobile notifications are working.",
    kind,
    sessionId,
    url: mobileTerminalNotificationUrl(sessionId),
  };
}

function isExpired(expirationTime: number | null, now: number): boolean {
  return typeof expirationTime === "number" && expirationTime <= now;
}

function isGonePushError(err: unknown): boolean {
  return err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410);
}

export function createMobileWebPushSender({
  config,
  store,
  sendNotification: send = sendNotification,
  now = () => Date.now(),
}: MobileWebPushSenderDeps): MobileWebPushSender {
  return {
    async sendTest(sessionId) {
      const resolved = config();
      if (!resolved.enabled) return { ok: false, reason: resolved.reason };

      const current = await store.list();
      const expired = current.filter((subscription) => isExpired(subscription.expirationTime, now())).map((subscription) => subscription.endpoint);
      if (expired.length) await store.removeEndpoints(expired);
      const targets = current.filter((subscription) => !expired.includes(subscription.endpoint));
      if (targets.length === 0) return { ok: true, sent: 0, failed: 0, targets: 0, removed: expired.length };

      const payload = JSON.stringify(buildMobileWebPushPayload("test", sessionId));
      let sent = 0;
      let failed = 0;
      const gone: string[] = [];

      await Promise.all(
        targets.map(async (subscription) => {
          try {
            const pushSubscription: PushSubscription = {
              endpoint: subscription.endpoint,
              expirationTime: subscription.expirationTime,
              keys: subscription.keys,
            };
            const result: SendResult = await send(pushSubscription, payload, {
              vapidDetails: resolved.vapid,
              TTL: 300,
              urgency: "normal",
              topic: "mulmoterminal-mobile-test",
            });
            if (result.statusCode >= 200 && result.statusCode < 300) sent += 1;
            else failed += 1;
          } catch (err) {
            failed += 1;
            if (isGonePushError(err)) gone.push(subscription.endpoint);
          }
        }),
      );

      if (gone.length) await store.removeEndpoints(gone);
      return { ok: true, sent, failed, targets: targets.length, removed: expired.length + gone.length };
    },
  };
}
