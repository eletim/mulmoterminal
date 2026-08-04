<script setup lang="ts">
import { ref } from "vue";
import { CELL_BTN } from "./cellChromeClasses";

const props = defineProps<{
  canDelete: boolean;
  deleting?: boolean;
  deleteError?: string | null | undefined;
}>();

const emit = defineEmits<{ (e: "hide" | "delete"): void }>();
const open = ref(false);

function hide(): void {
  open.value = false;
  emit("hide");
}

function deleteSession(): void {
  if (!props.canDelete || props.deleting) return;
  emit("delete");
}
</script>

<template>
  <span class="relative inline-flex flex-none">
    <button
      type="button"
      class="cell-btn"
      :class="CELL_BTN"
      title="Shared terminal actions"
      aria-label="Shared terminal actions"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="material-symbols-outlined" aria-hidden="true">more_vert</span>
    </button>
    <div v-if="open" class="absolute right-0 top-full z-30 mt-1 flex min-w-[190px] flex-col rounded-md border border-border bg-panel p-1 shadow-lg" role="menu">
      <button type="button" class="rounded px-2 py-1.5 text-left text-[12px] text-secondary hover:bg-hover hover:text-fg" role="menuitem" @click="hide">
        Hide on this device
      </button>
      <button
        v-if="canDelete"
        type="button"
        class="rounded px-2 py-1.5 text-left text-[12px] text-err-text hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        role="menuitem"
        :disabled="deleting"
        @click="deleteSession"
      >
        {{ deleting ? "Deleting..." : "Delete session..." }}
      </button>
      <p v-if="deleteError" class="m-0 max-w-[220px] px-2 py-1 text-[11px] text-err-text [overflow-wrap:anywhere]" role="status">
        {{ deleteError }}
      </p>
    </div>
  </span>
</template>
