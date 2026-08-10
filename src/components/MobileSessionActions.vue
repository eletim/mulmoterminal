<script setup lang="ts">
import { ref, watch } from "vue";

type SessionOperationStatus = "idle" | "sending" | "error";

interface ActionSession {
  id: string;
  title: string;
  live: boolean;
}

const props = defineProps<{
  session: ActionSession;
  interruptStatus: SessionOperationStatus;
  stopStatus: SessionOperationStatus;
}>();

const emit = defineEmits<{
  interrupt: [];
  stop: [sessionId: string];
}>();

const confirmingStop = ref(false);

function requestStopConfirmation(): void {
  if (props.stopStatus === "sending") return;
  confirmingStop.value = true;
}

function cancelStopConfirmation(): void {
  if (props.stopStatus === "sending") return;
  confirmingStop.value = false;
}

function confirmStop(): void {
  if (props.stopStatus === "sending") return;
  emit("stop", props.session.id);
}

watch(
  () => props.session.id,
  () => {
    confirmingStop.value = false;
  },
);

watch(
  () => props.stopStatus,
  (status) => {
    if (status === "idle") confirmingStop.value = false;
  },
);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      class="rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-panel"
      :disabled="!session.live || interruptStatus === 'sending'"
      @click="emit('interrupt')"
    >
      {{ interruptStatus === "sending" ? "Interrupting…" : "Interrupt" }}
    </button>
    <button
      type="button"
      class="rounded-md border border-err-border bg-err-bg px-3 py-1.5 text-[12px] text-err-text hover:bg-err-bg/80 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-err-bg"
      :disabled="stopStatus === 'sending'"
      @click="requestStopConfirmation"
    >
      Stop
    </button>
  </div>
  <p v-if="interruptStatus === 'error'" class="text-[12px] text-err-text">Failed to interrupt terminal session.</p>
  <p v-if="stopStatus === 'error'" class="text-[12px] text-err-text">Failed to stop terminal session.</p>

  <div v-if="confirmingStop" class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4" role="dialog" aria-modal="true">
    <div class="w-full max-w-sm rounded-md border border-border bg-panel p-4 shadow-lg">
      <h3 class="text-[14px] font-semibold text-fg">このセッションを停止しますか？</h3>
      <p class="mt-2 truncate text-[13px] text-secondary" :title="session.title">{{ session.title }}</p>
      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-border bg-panel px-3 py-1.5 text-[13px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-panel"
          :disabled="stopStatus === 'sending'"
          @click="cancelStopConfirmation"
        >
          キャンセル
        </button>
        <button
          type="button"
          class="rounded-md border border-err-border bg-err-bg px-3 py-1.5 text-[13px] font-medium text-err-text hover:bg-err-bg/80 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-err-bg"
          :disabled="stopStatus === 'sending'"
          @click="confirmStop"
        >
          {{ stopStatus === "sending" ? "停止中…" : "停止" }}
        </button>
      </div>
    </div>
  </div>
</template>
