<script setup lang="ts">
import { badgeStyleFor } from "./dirBadge";

// The directory's `name` from .mulmoterminal.json, as the coloured chip in a GRID cell's header.
// Shared by all three grid cells (Claude/codex, launcher, command) so a project reads the same
// wherever it is running — before this they had 1, 0 and 0 copies of it respectively (#914).
//
// The single view's badge (Terminal.vue) is deliberately NOT this component: its header has more
// room and uses a wider cap and looser leading, and unifying them would change how it looks.
defineProps<{ name: string | null | undefined; color: string | null | undefined }>();
</script>

<template>
  <span
    v-if="name"
    class="max-w-[14ch] flex-none truncate rounded-[10px] px-[7px] py-px font-sans text-[11px] font-semibold"
    :style="badgeStyleFor(color)"
    :title="name"
    >{{ name }}</span
  >
</template>
