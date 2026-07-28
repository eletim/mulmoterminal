<script setup lang="ts">
import { computed } from "vue";
import { modelBadge, type BadgeAgent } from "./modelBadge";

// Which model is running + how full its context is, e.g. `Opus · ctx 35%`. Nothing renders until
// the transcript has told us the model; the text and tooltip are decided in ./modelBadge.
const props = defineProps<{
  agent: BadgeAgent;
  model: string | null;
  contextTokens: number;
}>();

const badge = computed(() => (props.model ? modelBadge(props.agent, props.model, props.contextTokens) : null));
</script>

<template>
  <span v-if="badge" data-testid="model-badge" class="flex-none font-mono text-[10px] text-dim whitespace-nowrap tracking-[0.02em]" :title="badge.title">{{
    badge.text
  }}</span>
</template>
