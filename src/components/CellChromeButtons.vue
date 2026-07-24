<script setup lang="ts">
// The expand/restore and close buttons every grid cell's header ends with.
//
// Identical in the command and launcher cells, down to the labels and the glyphs, because
// they mean the same thing to the grid: one zooms this cell, the other retires it (#646 B3).
//
// TerminalCell keeps its own pair. Its close is not the same action — it may hold a live
// session, so it goes through a confirmation — and sharing a button whose click means two
// different things is how the confirmation would eventually get lost.
import { CELL_BTN, CELL_CLOSE_BTN } from "./cellChromeClasses";

defineProps<{ expanded: boolean }>();
const emit = defineEmits<{ (e: "toggle-expand" | "close"): void }>();
</script>

<template>
  <button
    class="cell-btn"
    :class="CELL_BTN"
    :title="expanded ? 'Restore' : 'Expand'"
    :aria-label="expanded ? 'Restore terminal' : 'Expand terminal'"
    @click="emit('toggle-expand')"
  >
    {{ expanded ? "⤡" : "⤢" }}
  </button>
  <button class="cell-btn cell-close" :class="CELL_CLOSE_BTN" title="Close terminal" aria-label="Close terminal" @click="emit('close')">✕</button>
</template>
