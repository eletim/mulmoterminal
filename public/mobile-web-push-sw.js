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

function agentLabel(agent) {
  if (agent === "codex") return "Codex";
  if (agent === "antigravity") return "Antigravity";
  if (agent === "shell") return "Terminal";
  return "Claude Code";
}

function notificationTitle(payload) {
  if (typeof payload.title === "string" && payload.title.trim() !== "") return payload.title;
  if (payload.kind === "waiting") return "MulmoTerminal needs input";
  if (payload.kind === "finished") return "MulmoTerminal done";
  if (payload.kind === "test") return "MulmoTerminal test";
  return "MulmoTerminal";
}

function notificationBody(payload) {
  if (typeof payload.body === "string" && payload.body.trim() !== "") return payload.body;
  if (payload.kind === "waiting") return `${agentLabel(payload.agent)} is waiting.`;
  if (payload.kind === "finished") return `${agentLabel(payload.agent)} finished.`;
  if (payload.kind === "test") return "Mobile notifications are working.";
  return "A mobile terminal session needs attention.";
}

function notificationTag(payload, kind) {
  if (kind !== "test" && kind !== "mobile") return undefined;
  return typeof payload.sessionId === "string" ? `mulmoterminal-mobile-${kind}-${payload.sessionId}` : `mulmoterminal-mobile-${kind}`;
}

function shouldUseNotificationSound(kind) {
  return kind === "finished";
}

self.addEventListener("push", (event) => {
  const payload = pushPayload(event);
  const url = notificationUrlFrom(payload);
  const kind = typeof payload.kind === "string" && payload.kind.trim() !== "" ? payload.kind : "mobile";

  event.waitUntil(
    (() => {
      const options = {
        body: notificationBody(payload),
        data: { url },
      };
      const tag = notificationTag(payload, kind);
      if (tag) options.tag = tag;
      if (shouldUseNotificationSound(kind)) options.silent = false;
      return self.registration.showNotification(notificationTitle(payload), options);
    })(),
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
