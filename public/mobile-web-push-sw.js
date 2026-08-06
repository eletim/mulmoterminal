/* global self, URL, URLSearchParams */

const MOBILE_TERMINALS_PATH = "/mobile/terminals";

function mobileTerminalsUrl(sessionId) {
  if (typeof sessionId !== "string" || sessionId.trim() === "") return MOBILE_TERMINALS_PATH;
  const params = new URLSearchParams({ sessionId });
  return `${MOBILE_TERMINALS_PATH}?${params.toString()}`;
}

function sameOriginMobileUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return MOBILE_TERMINALS_PATH;

  try {
    const candidate = new URL(raw, self.location.origin);
    if (candidate.origin !== self.location.origin) return MOBILE_TERMINALS_PATH;
    if (candidate.pathname !== MOBILE_TERMINALS_PATH) return MOBILE_TERMINALS_PATH;
    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return MOBILE_TERMINALS_PATH;
  }
}

function pushPayload(event) {
  if (!event.data) return {};

  try {
    const value = event.data.json();
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function notificationUrlFrom(payload) {
  if (typeof payload.url === "string") return sameOriginMobileUrl(payload.url);
  return mobileTerminalsUrl(payload.sessionId);
}

self.addEventListener("push", (event) => {
  const payload = pushPayload(event);
  const url = notificationUrlFrom(payload);

  event.waitUntil(
    self.registration.showNotification("MulmoTerminal", {
      body: "A mobile terminal session needs attention.",
      tag: typeof payload.sessionId === "string" ? `mulmoterminal-mobile-${payload.sessionId}` : "mulmoterminal-mobile",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = sameOriginMobileUrl(event.notification.data && event.notification.data.url);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin !== self.location.origin || clientUrl.pathname !== MOBILE_TERMINALS_PATH) continue;
        if ("navigate" in client && client.url !== new URL(url, self.location.origin).href) await client.navigate(url);
        await client.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
