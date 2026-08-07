<script setup lang="ts">
import { LAUNCH_AGENTS, type LaunchAgent } from "../../common/launchAgent";
import { rememberLaunchAgent } from "../composables/rememberedLaunchAgent";

defineProps<{
  agent: LaunchAgent;
  cwd: string;
  error: string;
  status: "idle" | "creating" | "error";
}>();

const emit = defineEmits<{
  (e: "create" | "cwd-touched"): void;
  (e: "update:agent", value: LaunchAgent): void;
  (e: "update:cwd", value: string): void;
}>();

function onCwdInput(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  emit("update:cwd", event.target.value);
  emit("cwd-touched");
}

function onAgentChange(event: Event): void {
  if (!(event.target instanceof HTMLSelectElement)) return;
  const target = event.target;
  const next = LAUNCH_AGENTS.find((agent) => agent === target.value);
  if (next) {
    rememberLaunchAgent(next);
    emit("update:agent", next);
  }
}
</script>

<template>
  <section class="mb-4 flex flex-col gap-2 rounded-md border border-border bg-elevated p-3">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-[13px] font-medium text-fg">New terminal</h2>
      <button
        type="button"
        class="flex-none rounded-md border border-border bg-panel px-2.5 py-1 text-[12px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-panel"
        :disabled="status === 'creating'"
        @click="emit('create')"
      >
        {{ status === "creating" ? "Starting…" : "Start" }}
      </button>
    </div>
    <label class="flex flex-col gap-1 text-[12px] text-secondary">
      <span>Working directory</span>
      <input
        :value="cwd"
        type="text"
        class="rounded-md border border-border bg-base px-2.5 py-2 font-mono text-[13px] text-fg placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50"
        placeholder="/path/to/project"
        :disabled="status === 'creating'"
        @input="onCwdInput"
      />
    </label>
    <label class="flex flex-col gap-1 text-[12px] text-secondary">
      <span>Agent</span>
      <select
        :value="agent"
        class="rounded-md border border-border bg-base px-2.5 py-2 text-[13px] text-fg disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="status === 'creating'"
        @change="onAgentChange"
      >
        <option v-for="knownAgent in LAUNCH_AGENTS" :key="knownAgent" :value="knownAgent">{{ knownAgent }}</option>
      </select>
    </label>
    <p v-if="status === 'error'" class="text-[12px] text-err-text">{{ error || "Failed to create terminal." }}</p>
  </section>
</template>
