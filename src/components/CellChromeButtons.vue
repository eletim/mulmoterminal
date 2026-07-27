<script setup lang="ts">
// The expand/restore and close buttons every grid cell's header ends with — identical in
// the command, launcher and terminal cells, down to the labels and the glyphs, because they
// mean the same thing to the grid: one zooms this cell, the other retires it (#646 B3).
//
// What "close" DOES stays with the parent: TerminalCell's may hold a live session, so its
// handler confirms before tearing down. This emits the intent and never acts on it, so a
// cell can't lose its confirmation by adopting the shared buttons (#826).
//
// No `.stop` on the clicks: the enclosing header's zoom gesture already ignores anything
// inside a button (shouldZoomOnHeaderClick), and stopping here would only hide that.
import { CELL_BTN, CELL_CLOSE_BTN } from "./cellChromeClasses";

defineProps<{ expanded: boolean; filesOpen?: boolean }>();
const emit = defineEmits<{ (e: "toggle-expand" | "close" | "toggle-files"): void }>();
</script>

<template>
  <button
    class="cell-btn"
    :class="CELL_BTN"
    :title="expanded ? 'Restore' : 'Expand'"
    :aria-label="expanded ? 'Restore terminal' : 'Expand terminal'"
    @click="emit('toggle-expand')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">{{ expanded ? "close_fullscreen" : "open_in_full" }}</span>
  </button>
  <!-- Only while enlarged: the pane splits the enlarged cell's room, which a tiled cell or a
       filmstrip thumbnail does not have. After expand/restore so the first `.cell-btn` keeps
       meaning what it always did. -->
  <button
    v-if="expanded"
    class="cell-btn"
    :class="CELL_BTN"
    :aria-pressed="!!filesOpen"
    :title="filesOpen ? 'Hide files' : 'Show files'"
    :aria-label="filesOpen ? 'Hide files' : 'Show files'"
    @click="emit('toggle-files')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
  </button>
  <button class="cell-btn cell-close" :class="CELL_CLOSE_BTN" title="Close terminal" aria-label="Close terminal" @click="emit('close')">
    <span class="material-symbols-outlined" aria-hidden="true">close</span>
  </button>
</template>
