<script setup lang="ts">
import { computed, ref } from "vue";
import {
  MOBILE_WEB_PUSH_PUBLIC_KEY,
  mobileTerminalNotificationUrl,
  mobileWebPushSupport,
  registerMobileWebPushServiceWorker,
  urlBase64ToUint8Array,
} from "../mobileWebPushClient";

const props = defineProps<{ sessionId: string | null }>();

type PushStatus = "checking" | "ready" | "unsupported" | "error";
type PushBusy = "enable" | "disable" | "test" | null;

const pushSupport = mobileWebPushSupport();
const pushStatus = ref<PushStatus>(pushSupport.supported ? "checking" : "unsupported");
const pushBusy = ref<PushBusy>(null);
const pushPermission = ref<NotificationPermission | "unknown">(pushSupport.supported ? Notification.permission : "unknown");
const pushSubscribed = ref(false);
const pushSubscriptionJson = ref<PushSubscriptionJSON | null>(null);
const pushError = ref<string | null>(pushSupport.supported ? null : pushSupport.reason);

const permissionLabel = computed(() => {
  if (pushPermission.value === "granted") return "Allowed";
  if (pushPermission.value === "denied") return "Blocked";
  if (pushPermission.value === "default") return "Not asked";
  return "Unknown";
});
const subscriptionLabel = computed(() => (pushSubscribed.value ? "Active" : "Off"));
const pushSummaryLabel = computed(() => {
  if (pushBusy.value) return "Working";
  if (pushStatus.value === "unsupported") return "Unsupported";
  if (pushStatus.value === "error") return "Needs attention";
  return pushSubscribed.value ? "On" : "Off";
});
const canEnablePush = computed(() => pushSupport.supported && !pushBusy.value && !pushSubscribed.value && pushPermission.value !== "denied");
const canDisablePush = computed(() => pushSupport.supported && !pushBusy.value && pushSubscribed.value);
const canTestPush = computed(() => pushSupport.supported && !pushBusy.value && pushPermission.value !== "denied");

function syncPushPermission(): void {
  if (!pushSupport.supported) return;
  pushPermission.value = Notification.permission;
}

function reflectSubscription(subscription: PushSubscription | null): void {
  pushSubscribed.value = subscription !== null;
  pushSubscriptionJson.value = subscription?.toJSON() ?? null;
}

async function refreshPushState(): Promise<void> {
  if (!pushSupport.supported) return;

  pushStatus.value = "checking";
  pushError.value = null;
  syncPushPermission();

  try {
    const registration = await registerMobileWebPushServiceWorker();
    reflectSubscription(await registration.pushManager.getSubscription());
    syncPushPermission();
    pushStatus.value = "ready";
  } catch {
    pushStatus.value = "error";
    pushError.value = "Failed to register notifications.";
  }
}

async function ensureNotificationPermission(): Promise<boolean> {
  if (!pushSupport.supported) return false;
  if (Notification.permission === "default") await Notification.requestPermission();
  syncPushPermission();

  if (Notification.permission === "granted") return true;
  pushError.value = Notification.permission === "denied" ? "Notifications are blocked in this browser." : "Notification permission was not granted.";
  return false;
}

async function enablePushNotifications(): Promise<void> {
  if (!pushSupport.supported || pushBusy.value) return;

  pushBusy.value = "enable";
  pushError.value = null;
  try {
    if (!(await ensureNotificationPermission())) return;

    const registration = await registerMobileWebPushServiceWorker();
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(MOBILE_WEB_PUSH_PUBLIC_KEY),
      }));
    reflectSubscription(subscription);
    pushStatus.value = "ready";
  } catch {
    pushStatus.value = "error";
    pushError.value = "Failed to subscribe to notifications.";
  } finally {
    pushBusy.value = null;
    syncPushPermission();
  }
}

async function disablePushNotifications(): Promise<void> {
  if (!pushSupport.supported || pushBusy.value) return;

  pushBusy.value = "disable";
  pushError.value = null;
  try {
    const registration = await registerMobileWebPushServiceWorker();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    reflectSubscription(null);
    pushStatus.value = "ready";
  } catch {
    pushStatus.value = "error";
    pushError.value = "Failed to unsubscribe from notifications.";
  } finally {
    pushBusy.value = null;
    syncPushPermission();
  }
}

async function showLocalTestNotification(): Promise<void> {
  if (!pushSupport.supported || pushBusy.value) return;

  pushBusy.value = "test";
  pushError.value = null;
  try {
    if (!(await ensureNotificationPermission())) return;
    const registration = await registerMobileWebPushServiceWorker();
    await registration.showNotification("MulmoTerminal test", {
      body: "Mobile notifications are working.",
      tag: "mulmoterminal-mobile-test",
      data: { url: mobileTerminalNotificationUrl(props.sessionId) },
    });
  } catch {
    pushStatus.value = "error";
    pushError.value = "Failed to show the test notification.";
  } finally {
    pushBusy.value = null;
    syncPushPermission();
  }
}

void refreshPushState();
</script>

<template>
  <section class="mb-4 rounded-md border border-border bg-panel p-3 text-[12px]" data-testid="mobile-web-push-panel">
    <div class="mb-2 flex items-center justify-between gap-2">
      <h2 class="text-[13px] font-medium text-fg">Notifications</h2>
      <span class="flex-none text-secondary">{{ pushSummaryLabel }}</span>
    </div>

    <div class="grid grid-cols-2 gap-x-3 gap-y-1">
      <span class="text-muted">Permission</span>
      <span class="text-fg">{{ permissionLabel }}</span>
      <span class="text-muted">Subscription</span>
      <span class="text-fg">{{ subscriptionLabel }}</span>
    </div>

    <p v-if="pushSubscriptionJson" class="mt-2 text-muted">Subscription ready for server storage.</p>
    <p v-if="pushError" class="mt-2 text-err-text">{{ pushError }}</p>

    <div class="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded-md border border-border bg-elevated px-2.5 py-1 text-[12px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-elevated"
        :disabled="!canEnablePush"
        @click="enablePushNotifications"
      >
        Enable
      </button>
      <button
        type="button"
        class="rounded-md border border-border bg-elevated px-2.5 py-1 text-[12px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-elevated"
        :disabled="!canDisablePush"
        @click="disablePushNotifications"
      >
        Disable
      </button>
      <button
        type="button"
        class="rounded-md border border-border bg-elevated px-2.5 py-1 text-[12px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-elevated"
        :disabled="!canTestPush"
        @click="showLocalTestNotification"
      >
        Test notification
      </button>
    </div>
  </section>
</template>
