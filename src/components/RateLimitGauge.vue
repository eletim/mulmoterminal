<script setup lang="ts">
// The 5h / 7d windows, always on screen in the grid header (#387).
//
// Always visible rather than a hover tip, which is what #388 shipped and what this replaces: the
// point is to notice a window filling up WITHOUT going to look, because by the time you think to
// check you have usually already hit it. The reset times stay on hover — they answer the second
// question, not the first.
import { computed, onMounted, onUnmounted } from "vue";
import { useRateLimits } from "../composables/useRateLimits";
import { agentGauges, gaugeTitle } from "../composables/rateLimitGauge";

const { snapshot, start, stop } = useRateLimits();
onMounted(start);
onUnmounted(stop);

const gauges = computed(() => agentGauges(snapshot.value));
// Read once per render rather than per window, so the two figures in a row cannot disagree about
// what time it is.
const titleFor = (agent: "claude" | "codex") => gaugeTitle(agent, snapshot.value?.[agent] ?? null, Date.now());
</script>

<template>
  <!-- Nothing at all until something reports: an agent that is not installed, is on API-key
       billing, or has not run yet all arrive here as an empty list, and an empty gauge would be
       one more thing to explain rather than information. -->
  <span
    v-for="gauge in gauges"
    :key="gauge.agent"
    class="ml-1.5 inline-flex flex-none items-center gap-1.5 border-l border-border pl-2.5"
    role="img"
    :aria-label="titleFor(gauge.agent)"
    :title="titleFor(gauge.agent)"
  >
    <span v-if="gauge.prefix" class="font-mono text-[11px] leading-none text-muted" aria-hidden="true">{{ gauge.prefix }}</span>
    <span
      v-for="window in gauge.windows"
      :key="window.label"
      class="font-mono text-[12px] leading-none"
      :class="window.warn ? 'text-amber' : 'text-muted'"
      aria-hidden="true"
      >{{ window.label }} {{ window.percent }}%</span
    >
  </span>
</template>
