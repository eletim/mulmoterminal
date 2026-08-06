export const MOBILE_WEB_PUSH_SW_URL = "/mobile-web-push-sw.js";
export const MOBILE_WEB_PUSH_SW_SCOPE = "/";

// Public-only VAPID key used so the browser can create a PushSubscription in this
// client-only slice. The matching private key is intentionally not in the repo;
// server-side push delivery and persisted subscriptions are the follow-up issue.
export const MOBILE_WEB_PUSH_PUBLIC_KEY = "BDCNh5z_3cDbWkcfgYzTs8uHi3AGwGUYXq2LZ1hHYwV3G3r6wauEOCh_2GwiCSA0H82cel5ItH4pPCHlMPYGPDg";

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
  if (!sessionId) return "/mobile/terminals";
  const params = new URLSearchParams({ sessionId });
  return `/mobile/terminals?${params.toString()}`;
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
