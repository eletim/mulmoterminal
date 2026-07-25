<script setup lang="ts">
// Toolbar control for the remote-host command channel: drive MulmoTerminal from
// a phone (the mulmoserver PWA) over Firestore.
//
// Google sign-in popup (browser Firebase) → extract the Google OAuth idToken →
// POST it to /api/remote-host/connect, where the server signs in as the user and
// starts the Firestore command loop + presence heartbeat. The dropdown shows
// online/offline + the connected uid and offers Connect / Disconnect. Trigger and
// panel chrome are shared with NotificationBell via toolbarPopover.css.
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { renderSVG } from "uqr";

import ToolbarPopover from "./ToolbarPopover.vue";
import { auth } from "../config/firebase";
// Session parking (localStorage) + reconnect-outcome decision live in a plain module
// so they're unit-testable without mounting this Firebase-importing component.
import { healthOrFallback, loadStoredSession, persistSession, reconnectAction, type FetchResult, type RemoteHostStatus } from "./remoteHostSession";
import { registerRemoteHostSelfHeal } from "./remoteHostSelfHeal";
import { remoteHostView } from "./remoteHostView";
import { usePubSub } from "../composables/usePubSub";
import type { RunnerHealth } from "../../common/remoteHostHealth";

// Mobile companion PWA — shown in the dropdown as help text (not fetched here).
const MOBILE_URL = "https://mulmoserver.web.app";
// Rendered to a data URL (uqr output is ASCII-only SVG) so no v-html is needed.
const qrDataUrl = `data:image/svg+xml;base64,${btoa(renderSVG(MOBILE_URL))}`;

const busy = ref(false);
const error = ref<string | null>(null);
const status = ref<RemoteHostStatus>({ connected: false, uid: null });
const health = ref<RunnerHealth>({ state: "offline", lastError: null, changedAt: 0 });
const popoverRef = useTemplateRef<InstanceType<typeof ToolbarPopover>>("popover");

// "Online" only while the channel is actually subscribed — a runner re-subscribing after
// an outage says so, instead of showing green while the phone still can't reach us (#823).
const view = computed(() => remoteHostView(status.value.connected, health.value.state));
const isReconnecting = computed(() => view.value.reconnecting);

function onPopoverOpen() {
  refreshStatus().catch(() => undefined);
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function fetchStatus(url: string, method: "GET" | "POST", body?: unknown): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      return { ok: false, error: (detail && typeof detail.error === "string" && detail.error) || `HTTP ${res.status}`, httpStatus: res.status };
    }
    const data = (await res.json()) as { status: RemoteHostStatus; session: string | null; health?: unknown };
    return { ok: true, status: data.status, session: data.session ?? null, health: healthOrFallback(data.health, data.status.connected) };
  } catch (err) {
    return { ok: false, error: errorText(err), httpStatus: 0 };
  }
}

function applyOk(result: Extract<FetchResult, { ok: true }>): void {
  status.value = result.status;
  health.value = result.health;
}

async function refreshStatus() {
  const result = await fetchStatus("/api/remote-host/status", "GET");
  if (result.ok) {
    applyOk(result);
    // Keep the parked blob fresh (the refresh token can rotate) — but never clear
    // it on a disconnected status, so an auto-reconnect still has it.
    if (result.session) persistSession(result.session);
    error.value = null;
  } else {
    error.value = result.error;
  }
}

// On load, if the server is disconnected but we have a parked session, restore it
// without a popup. A 401 means the blob is genuinely expired/invalid → drop it;
// transient failures KEEP it so a later retry/restart can still reconnect.
async function tryAutoReconnect() {
  if (status.value.connected) return;
  // The server re-subscribes on its own for a while; replaying the blob meanwhile would
  // tear down a session that is still healing and open a fresh Firebase app each poll.
  if (isReconnecting.value) return;
  const blob = loadStoredSession();
  if (!blob) return;
  const res = await fetchStatus("/api/remote-host/reconnect", "POST", { session: blob });
  if (res.ok) applyOk(res);
  const action = reconnectAction(res);
  if (action === "park" && res.ok) persistSession(res.session);
  else if (action === "drop") persistSession(null);
}

async function onConnect() {
  busy.value = true;
  error.value = null;
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const idToken = GoogleAuthProvider.credentialFromResult(result)?.idToken;
    if (!idToken) {
      error.value = "Could not obtain a Google sign-in token.";
      return;
    }
    const res = await fetchStatus("/api/remote-host/connect", "POST", { idToken });
    if (!res.ok) {
      error.value = res.error;
      return;
    }
    applyOk(res);
    persistSession(res.session); // park the session for popup-free reconnect after a restart
    popoverRef.value?.close();
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

async function onDisconnect() {
  busy.value = true;
  error.value = null;
  const res = await fetchStatus("/api/remote-host/disconnect", "POST");
  if (res.ok) {
    applyOk(res);
    persistSession(null); // forget the parked session on an explicit disconnect
    popoverRef.value?.close();
  } else {
    error.value = res.error;
  }
  busy.value = false;
}

// Re-check the real connection state and, if the server dropped our parked session
// (e.g. it restarted while this tab stayed open), re-push it popup-free.
function selfHeal() {
  return refreshStatus()
    .then(tryAutoReconnect)
    .catch(() => undefined);
}

// On mount: heal once. Then keep healing on the signals that mean the server may
// have come back or we returned to the tab — without this a server restart leaves
// the UI showing "connected" while every Web Push silently no-ops.
const pubsub = usePubSub();
let stopSelfHeal: (() => void) | null = null;
onMounted(() => {
  void selfHeal();
  stopSelfHeal = registerRemoteHostSelfHeal(() => void selfHeal(), pubsub.onReconnect);
});
onUnmounted(() => stopSelfHeal?.());
</script>

<template>
  <ToolbarPopover
    ref="popover"
    icon="phonelink"
    :title="view.online ? 'Remote host connected' : view.reconnecting ? 'Remote host reconnecting' : 'Remote host'"
    trigger-label="Remote host"
    pane-class="w-[300px] gap-2 p-2.5 font-sans"
    pane-label="Remote host"
    :trigger-class="{ connected: view.online }"
    @open="onPopoverOpen"
  >
    <div class="flex items-center gap-1.5">
      <span class="material-symbols-outlined text-[16px] leading-none" :class="view.toneClass">
        {{ view.icon }}
      </span>
      <span class="text-[12px] font-semibold text-fg">{{ view.label }}</span>
    </div>

    <p v-if="status.uid" class="font-mono text-[10px] text-muted [overflow-wrap:anywhere]">Signed in as {{ status.uid }}</p>

    <p v-if="health.lastError && health.state !== 'online'" class="text-[11px] leading-[1.4] text-[#e0a526] [overflow-wrap:anywhere]">
      Last channel error: {{ health.lastError }}
    </p>

    <button
      v-if="!status.connected"
      type="button"
      class="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-accent-bg px-2.5 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="busy"
      @click="onConnect"
    >
      <span class="material-symbols-outlined text-[16px] leading-none">login</span>
      {{ busy ? "Connecting…" : "Connect (Google sign-in)" }}
    </button>
    <button
      v-else
      type="button"
      class="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 text-[12px] font-medium text-fg enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="busy"
      @click="onDisconnect"
    >
      <span class="material-symbols-outlined text-[16px] leading-none">logout</span>
      {{ busy ? "Disconnecting…" : "Disconnect" }}
    </button>

    <p v-if="error" class="text-[11px] text-[#e0533d] [overflow-wrap:anywhere]">{{ error }}</p>

    <div class="flex flex-col gap-1.5 border-t border-border pt-2 text-[11px] leading-[1.4] text-muted">
      <p>Drive this terminal from your phone over a Firestore command channel — list collections, browse records, and start a chat.</p>
      <p>
        Open
        <a :href="MOBILE_URL" target="_blank" rel="noopener noreferrer" class="font-mono text-[#6ea8fe] [overflow-wrap:anywhere]">{{ MOBILE_URL }}</a>
        on your phone, signed in with the same Google account.
      </p>
      <div class="flex flex-col items-center gap-1.5 pt-0.5">
        <img :src="qrDataUrl" alt="" aria-hidden="true" class="h-32 w-32 rounded-md" />
        <p>Or scan this QR code with your phone's camera.</p>
      </div>
    </div>
  </ToolbarPopover>
</template>
