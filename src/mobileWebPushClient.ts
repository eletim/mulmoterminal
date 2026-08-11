import { isRecord } from "../common/isRecord";
import { jsonBody } from "./jsonBody";
import { withAppBasePath } from "./basePath";

export const MOBILE_WEB_PUSH_SW_URL = withAppBasePath("/mobile-web-push-sw.js");
export const MOBILE_WEB_PUSH_SW_SCOPE = withAppBasePath("/");
export const MOBILE_WEB_PUSH_CONFIG_URL = withAppBasePath("/api/mobile/web-push/config");
export const MOBILE_WEB_PUSH_SUBSCRIPTIONS_URL = withAppBasePath("/api/mobile/web-push/subscriptions");
export const MOBILE_WEB_PUSH_TEST_URL = withAppBasePath("/api/mobile/web-push/test");

export type MobileWebPushSupport =
  | { supported: true }
  | {
      supported: false;
      reason: string;
    };

export function mobileWebPushSupport(): MobileWebPushSupport {
  if (!("serviceWorker" in navigator)) return { supported: false, reason: "Service Worker is not available in this browser." };
  if (typeof PushManager === "undefined") return { supported: false, reason: "Push API is not available in this browser." };
  if (typeof Notification === "undefined") return { supported: false, reason: "Notifications are not available in this browser." };
  return { supported: true };
}

export function mobileTerminalNotificationUrl(sessionId: string | null | undefined): string {
  if (!sessionId) return withAppBasePath("/mobile/terminals");
  const params = new URLSearchParams({ sessionId });
  return `${withAppBasePath("/mobile/terminals")}?${params.toString()}`;
}

export function readSessionIdQuery(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (Array.isArray(value)) return readSessionIdQuery(value[0]);
  return null;
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function registerMobileWebPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(MOBILE_WEB_PUSH_SW_URL, { scope: MOBILE_WEB_PUSH_SW_SCOPE });
}

export interface MobileWebPushServerConfig {
  enabled: boolean;
  publicKey: string | null;
  reason: string | null;
}

function parseServerConfig(value: Record<string, unknown>): MobileWebPushServerConfig {
  const enabled = value.enabled === true;
  const publicKey = typeof value.publicKey === "string" && value.publicKey.trim() !== "" ? value.publicKey : null;
  const reason = typeof value.reason === "string" && value.reason.trim() !== "" ? value.reason : null;
  return { enabled: enabled && publicKey !== null, publicKey, reason };
}

async function checkedJsonRequest(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const body = await jsonBody(res);
  if (res.ok) return body;
  const error = typeof body.error === "string" && body.error.trim() !== "" ? body.error : `HTTP ${res.status}`;
  throw new Error(error);
}

export async function fetchMobileWebPushConfig(): Promise<MobileWebPushServerConfig> {
  return parseServerConfig(await checkedJsonRequest(MOBILE_WEB_PUSH_CONFIG_URL));
}

export async function registerMobileWebPushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  if (!isRecord(subscription) || typeof subscription.endpoint !== "string") throw new Error("subscription endpoint is missing");
  await checkedJsonRequest(MOBILE_WEB_PUSH_SUBSCRIPTIONS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription }),
  });
}

export async function unregisterMobileWebPushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  if (!isRecord(subscription) || typeof subscription.endpoint !== "string") throw new Error("subscription endpoint is missing");
  await checkedJsonRequest(MOBILE_WEB_PUSH_SUBSCRIPTIONS_URL, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
}

export async function sendMobileWebPushTest(sessionId: string | null | undefined): Promise<void> {
  await checkedJsonRequest(MOBILE_WEB_PUSH_TEST_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? null }),
  });
}
