<script setup lang="ts">
// The 5h / 7d windows, always on screen in the grid header (#387).
//
// Always visible rather than a hover tip, which is what #388 shipped and what this replaces: the
// point is to notice a window filling up WITHOUT going to look, because by the time you think to
// check you have usually already hit it. The reset times stay on hover — they answer the second
// question, not the first.
import { computed, onMounted, onUnmounted } from "vue";
import { useRateLimits } from "../composables/useRateLimits";
import { agentGauges, gaugeTitle, claudeProbeNote } from "../composables/rateLimitGauge";
import AgentMark from "./AgentMark.vue";

const { snapshot, start, stop } = useRateLimits();
onMounted(start);
onUnmounted(stop);

const gauges = computed(() => agentGauges(snapshot.value));
// Read once per render rather than per window, so the two figures in a row cannot disagree about
// what time it is.
const titleFor = (agent: "claude" | "codex") => gaugeTitle(agent, snapshot.value?.[agent] ?? null, Date.now());
// Shown in place of the Claude figures when they cannot arrive. Not an error banner: it sits
// where the numbers would be, in the muted colour, because it is the same kind of information —
// "here is what we know about your usage" (#1011).
const probeNote = computed(() => claudeProbeNote(snapshot.value));
</script>

<template>
  <!-- Nothing at all until something reports: an agent that is not installed, is on API-key
       billing, or has not run yet all arrive here as an empty list, and an empty gauge would be
       one more thing to explain rather than information. -->
  <span
    v-if="probeNote"
    class="ml-1.5 inline-flex flex-none items-center border-l border-border pl-2.5 font-mono text-[12px] leading-none text-dim"
    role="note"
    :title="probeNote"
    data-testid="rate-limit-note"
    >claude usage n/a</span
  >
  <span
    v-for="gauge in gauges"
    :key="gauge.agent"
    class="ml-1.5 inline-flex flex-none items-center gap-1.5 border-l border-border pl-2.5"
    role="img"
    :aria-label="titleFor(gauge.agent)"
    :title="titleFor(gauge.agent)"
  >
    <AgentMark v-if="gauge.marked" :agent="gauge.agent" :class="gauge.windows.some((w) => w.warn) ? 'text-amber' : 'text-muted'" />
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
