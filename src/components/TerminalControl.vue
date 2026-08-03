<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { TERMINAL_CONTROL_DEFAULT_LABEL, TERMINAL_CONTROL_LABEL_MAX_LENGTH, normalizeTerminalControlLabel } from "../../common/terminalControl";
import { useTerminalControl } from "../composables/useTerminalControl";
import ToolbarPopover from "./ToolbarPopover.vue";

const control = useTerminalControl();
const labelDraft = ref(control.label.value);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

const connected = computed(() => control.connectionStatus.value === "connected");
const disconnected = computed(() => control.connectionStatus.value === "disconnected");
const syncing = computed(() => control.connectionStatus.value === "connecting" || (connected.value && !control.state.value));
const isOwner = computed(() => control.isOwner.value);
const owner = computed(() => control.owner.value);
const ownerLabel = computed(() => owner.value?.label ?? TERMINAL_CONTROL_DEFAULT_LABEL);
const ownerReserved = computed(() => owner.value !== null && !owner.value.connected);
const canAct = computed(() => connected.value && control.state.value !== null);
const triggerTitle = computed(() => terminalControlTriggerTitle(isOwner.value, disconnected.value));
const triggerClass = computed(() => ({ connected: isOwner.value, disconnected: disconnected.value }));
const takeLabel = computed(() => (ownerReserved.value ? "Take control now" : "Take control"));
const currentLabel = computed(() => control.label.value);
const errorMessage = computed(() => control.error.value?.message ?? "");
const remainingSeconds = computed(() => {
  const expires = control.leaseExpiresAt.value;
  return expires === null ? null : Math.max(0, Math.ceil((expires - now.value) / 1000));
});

function onOpen(): void {
  labelDraft.value = control.label.value;
}

function acquire(): void {
  if (!canAct.value) return;
  if (owner.value && !isOwner.value) {
    const ok = window.confirm(`Take control from "${ownerLabel.value}"?\nTheir terminal will become view-only.`);
    if (!ok) return;
  }
  control.acquire();
}

function release(): void {
  control.release();
}

function saveLabel(): void {
  labelDraft.value = control.setLabel(labelDraft.value);
}

function terminalControlTriggerTitle(ownerTab: boolean, disconnectedChannel: boolean): string {
  if (ownerTab) return "This tab has terminal control";
  if (disconnectedChannel) return "Terminal control disconnected";
  return "Terminal control";
}

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <ToolbarPopover
    icon="devices"
    :title="triggerTitle"
    trigger-label="Terminal control"
    pane-class="w-[280px] gap-2 p-2.5 font-sans"
    pane-label="Terminal control"
    :trigger-class="triggerClass"
    @open="onOpen"
  >
    <template v-if="syncing">
      <p class="text-[12px] font-semibold text-fg">Connecting to terminal control…</p>
      <button
        type="button"
        class="inline-flex h-8 items-center justify-center rounded-md border border-border px-2.5 text-[12px] text-muted opacity-50"
        disabled
      >
        Take control
      </button>
    </template>

    <template v-else-if="disconnected">
      <p class="text-[12px] font-semibold text-[#e0533d]">Terminal control connection lost</p>
      <p class="text-[11px] text-muted">Reconnecting automatically</p>
      <p v-if="errorMessage" class="text-[11px] text-[#e0533d] [overflow-wrap:anywhere]">{{ errorMessage }}</p>
      <button
        type="button"
        class="inline-flex h-8 items-center justify-center rounded-md border border-border px-2.5 text-[12px] text-muted opacity-50"
        disabled
      >
        Take control
      </button>
    </template>

    <template v-else-if="isOwner">
      <p class="text-[12px] font-semibold text-fg">This tab has control</p>
      <p class="text-[11px] text-muted [overflow-wrap:anywhere]">{{ currentLabel }}</p>
      <button
        type="button"
        class="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 text-[12px] font-medium text-fg enabled:hover:bg-hover"
        @click="release"
      >
        <span class="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">logout</span>
        Release control
      </button>
    </template>

    <template v-else>
      <p class="text-[12px] font-semibold text-fg">View only</p>
      <template v-if="owner">
        <p v-if="owner.connected" class="text-[11px] text-muted [overflow-wrap:anywhere]">{{ ownerLabel }} has control</p>
        <p v-else class="text-[11px] text-muted [overflow-wrap:anywhere]">
          {{ ownerLabel }} is reconnecting<span v-if="remainingSeconds !== null"> — {{ remainingSeconds }}s left</span>
        </p>
      </template>
      <p v-else class="text-[11px] text-muted">No tab currently has control</p>
      <button
        type="button"
        class="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-accent-bg px-2.5 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canAct"
        @click="acquire"
      >
        <span class="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">touch_app</span>
        {{ owner ? takeLabel : "Take control" }}
      </button>
    </template>

    <form class="mt-1 flex flex-col gap-1.5 border-t border-border pt-2" @submit.prevent="saveLabel">
      <label class="text-[11px] font-medium text-muted" for="terminal-control-label">This device label</label>
      <div class="flex gap-1.5">
        <input
          id="terminal-control-label"
          v-model="labelDraft"
          class="min-w-0 flex-1 rounded-md border border-border bg-panel px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
          :maxlength="TERMINAL_CONTROL_LABEL_MAX_LENGTH"
          autocomplete="off"
        />
        <button type="submit" class="flex-none rounded-md border border-border px-2 py-1 text-[12px] text-fg enabled:hover:bg-hover">Save</button>
      </div>
      <p class="text-[10px] text-muted">Empty names become {{ normalizeTerminalControlLabel("") }}.</p>
    </form>
  </ToolbarPopover>
</template>
