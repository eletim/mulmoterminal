<script setup lang="ts">
import { nextTick, ref, watch, onUnmounted } from "vue";
import { modalKeydownHandler } from "../composables/useModalKeyboard";
import { isRecord } from "../../common/isRecord";

interface DirectoryEntry {
  name: string;
  path: string;
}

interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: DirectoryEntry[];
}

const props = defineProps<{ open: boolean; initialPath: string | null }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "select", path: string): void;
}>();

const modalEl = ref<HTMLElement | null>(null);
const currentPath = ref("");
const parentPath = ref<string | null>(null);
const directories = ref<DirectoryEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const isDirectoryEntry = (value: unknown): value is DirectoryEntry => isRecord(value) && typeof value.name === "string" && typeof value.path === "string";
const isDirectoryListing = (value: unknown): value is DirectoryListing =>
  isRecord(value) &&
  typeof value.path === "string" &&
  (value.parent === null || typeof value.parent === "string") &&
  Array.isArray(value.directories) &&
  value.directories.every(isDirectoryEntry);

let requestId = 0;
async function load(path: string | null): Promise<void> {
  const mine = ++requestId;
  loading.value = true;
  error.value = null;
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  const query = params.toString();
  try {
    const res = await fetch(query ? `/api/directories?${query}` : "/api/directories");
    if (!res.ok) throw new Error(String(res.status));
    const data: unknown = await res.json();
    if (!isDirectoryListing(data)) throw new Error("bad response");
    if (mine !== requestId) return;
    currentPath.value = data.path;
    parentPath.value = data.parent;
    directories.value = data.directories;
  } catch {
    if (mine === requestId) error.value = "Couldn't load that directory.";
  } finally {
    if (mine === requestId) loading.value = false;
  }
}

const close = () => emit("close");
const onKeydown = modalKeydownHandler({ modalEl, onClose: close, trapSelector: "button" });

function resetView(): void {
  currentPath.value = "";
  parentPath.value = null;
  directories.value = [];
  error.value = null;
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      document.removeEventListener("keydown", onKeydown);
      return;
    }
    document.addEventListener("keydown", onKeydown);
    resetView();
    void load(props.initialPath);
    void nextTick(() => modalEl.value?.focus());
  },
  { immediate: true },
);

onUnmounted(() => document.removeEventListener("keydown", onKeydown));

function choose(): void {
  if (currentPath.value) emit("select", currentPath.value);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.45)] px-3" @click.self="close">
      <div
        ref="modalEl"
        data-testid="folder-picker-modal"
        class="flex max-h-[82vh] w-[min(560px,94vw)] flex-col overflow-hidden rounded-lg bg-panel text-fg shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
        role="dialog"
        aria-modal="true"
        aria-label="Choose working directory"
        tabindex="-1"
      >
        <div class="flex items-center gap-2 border-b border-b-border px-3.5 py-2.5">
          <span class="font-sans text-[13px] font-semibold">Choose working directory</span>
          <button
            type="button"
            class="ml-auto inline-flex cursor-pointer items-center justify-center border-0 bg-transparent text-secondary hover:text-fg"
            aria-label="Close folder picker"
            @click="close"
          >
            <span class="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="border-b border-b-border bg-deep px-3.5 py-2 font-mono text-[12px] text-secondary break-all" data-testid="folder-picker-path">
          {{ currentPath || " " }}
        </div>
        <div class="min-h-[220px] overflow-y-auto py-1.5">
          <p v-if="loading && !currentPath" data-testid="folder-picker-state" class="px-3.5 py-8 text-center font-sans text-[12px] text-dim">Loading…</p>
          <p v-else-if="error && !currentPath" data-testid="folder-picker-state" class="px-3.5 py-8 text-center font-sans text-[12px] text-err-text">
            {{ error }}
          </p>
          <template v-else>
            <p
              v-if="error"
              data-testid="folder-picker-error"
              class="mx-3.5 mb-1 rounded-md bg-[var(--err-hover-bg)] px-2.5 py-1.5 font-sans text-[12px] text-err-text"
            >
              {{ error }}
            </p>
            <p v-else-if="loading" data-testid="folder-picker-state" class="px-3.5 py-2 font-sans text-[12px] text-dim">Loading…</p>
            <button
              v-if="parentPath"
              type="button"
              data-testid="folder-picker-parent"
              class="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3.5 py-2 text-left font-sans text-[13px] text-secondary hover:bg-hover hover:text-fg"
              @click="load(parentPath)"
            >
              <span class="material-symbols-outlined text-[18px]" aria-hidden="true">drive_folder_upload</span>
              ..
            </button>
            <button
              v-for="dir in directories"
              :key="dir.path"
              type="button"
              data-testid="folder-picker-dir"
              class="flex w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent px-3.5 py-2 text-left font-sans text-[13px] text-secondary hover:bg-hover hover:text-fg"
              :title="dir.path"
              @click="load(dir.path)"
            >
              <span class="material-symbols-outlined flex-none text-[18px]" aria-hidden="true">folder</span>
              <span class="truncate">{{ dir.name }}</span>
            </button>
            <p v-if="!parentPath && directories.length === 0" data-testid="folder-picker-state" class="px-3.5 py-8 text-center font-sans text-[12px] text-dim">
              No directories.
            </p>
          </template>
        </div>
        <div class="flex justify-end gap-2 border-t border-t-border px-3.5 py-2.5">
          <button
            type="button"
            class="cursor-pointer rounded-md border border-border bg-transparent px-3 py-1.5 font-sans text-[12px] text-secondary hover:bg-hover hover:text-fg"
            @click="close"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="folder-picker-select"
            class="cursor-pointer rounded-md border border-accent bg-accent px-3 py-1.5 font-sans text-[12px] font-medium text-[var(--accent-contrast,#fff)] disabled:cursor-default disabled:opacity-50"
            :disabled="loading || !currentPath"
            @click="choose"
          >
            Select
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
