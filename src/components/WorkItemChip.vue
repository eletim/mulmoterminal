<script setup lang="ts">
// What this cell is working on: `#977 → #966` — the branch's PR, and the issue that PR closes.
// With many cells in the grid it is the only place that answers "which of these is on the thing
// I asked about", which is how a PR gets left half-finished when a cell is reused (#979).
//
// Disappears the moment the PR is merged (or closed): the work is over, and a stale badge is
// worse than none. Before a PR exists the issue shows on its own, since that is most of the time
// a cell spends on an issue.
import { computed } from "vue";
import type { WorkItem } from "../../common/prPhase";
import { hasWorkToShow } from "../composables/useWorkItem";
import { phaseDisplay } from "./rosterPhase";

const props = defineProps<{ item: WorkItem }>();

const show = computed(() => hasWorkToShow(props.item));
const phase = computed(() => phaseDisplay(props.item.phase));

const title = computed(() => {
  const parts: string[] = [];
  if (props.item.pr !== null) parts.push(phase.value ? `PR #${props.item.pr} — ${phase.value.title}` : `PR #${props.item.pr}`);
  if (props.item.issue !== null) parts.push(`issue #${props.item.issue}`);
  return parts.join(" · ");
});
</script>

<template>
  <span
    v-if="show"
    data-testid="work-chip"
    class="inline-flex h-[1.5em] max-w-[18ch] flex-none items-center gap-[0.25em] overflow-hidden whitespace-nowrap rounded-[0.75em] bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-[0.4em] text-[0.72rem] leading-[1.5em] opacity-85"
    :title="title"
  >
    <a
      v-if="item.pr !== null"
      data-testid="work-pr"
      :href="item.prUrl ?? undefined"
      target="_blank"
      rel="noopener"
      class="text-inherit no-underline hover:underline"
      >#{{ item.pr }}</a
    >
    <span v-if="item.pr !== null && item.issue !== null" data-testid="work-arrow" class="opacity-60">→</span>
    <a
      v-if="item.issue !== null"
      data-testid="work-issue"
      :href="item.issueUrl ?? undefined"
      target="_blank"
      rel="noopener"
      class="text-inherit no-underline hover:underline"
      >#{{ item.issue }}</a
    >
    <span v-if="phase" data-testid="work-phase" class="opacity-70">{{ phase.label }}</span>
  </span>
</template>
