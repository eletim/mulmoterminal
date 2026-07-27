<script setup lang="ts">
// The full-screen Files view: FilesPane in a fixed frame, driven by the /files?cwd= route
// (useFilesView). Everything about browsing and editing lives in the pane — what is here is
// the route coupling, which the pane beside a zoomed grid cell does not have.
import { nextTick, ref, watch } from "vue";
import { useFilesView } from "../composables/useFilesView";
import FilesPane from "./FilesPane.vue";

const { isOpen, cwd, requestedPath, close } = useFilesView();

const pane = ref<InstanceType<typeof FilesPane> | null>(null);
// The root the pane is ACTUALLY on. It trails the route when a parting save could be written
// nowhere: the pane keeps the old tree and buffer, and it has to keep the old root with them —
// handing it the new `?cwd=` would send the next save to the same relative path in a DIFFERENT
// project. TerminalGrid pins its own for the same reason.
const paneCwd = ref<string | null>(cwd.value);

// Leaving the view (external nav / Back) or changing root (?cwd=) is leaving the open file, so
// the buffer is saved rather than asked about — the same bargain the pane makes everywhere
// else. The watcher runs before the re-render that unmounts the pane, and flush() reads the
// document synchronously, so the content is captured even on the way out.
watch([isOpen, cwd], async ([open, curCwd], prev) => {
  const wasOpen = prev?.[0] ?? false;
  // Opening mounts the pane fresh against whatever root the route asks for.
  if (!wasOpen) {
    paneCwd.value = curCwd;
    return;
  }
  const rootChanged = open && curCwd !== (prev?.[1] ?? null);
  // Awaited: the save has to finish before the tree it is being replaced by is read, and a
  // parting save that hits a conflict still has a backup to write afterwards.
  const safe = !open || rootChanged ? await pane.value?.flush() : true;
  // A root change keeps the pane mounted, and only this side knows the change happened — so a
  // buffer that could be neither saved nor backed up keeps the old tree, the old root and its
  // buffer. (Closing the view outright unmounts the pane either way; there the backup store IS
  // the guarantee, and a store that refuses the write is the one hole left.)
  if (!rootChanged || safe === false) return;
  paneCwd.value = curCwd;
  await nextTick(); // the pane reads its `cwd` prop when reloading, so let the new one land
  pane.value?.reload();
});
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 bg-deep flex flex-col" role="region" aria-label="Files">
    <FilesPane ref="pane" :cwd="paneCwd" :requested-path="requestedPath" @close="close">
      <template #title>
        <span class="text-[14px] font-[650] text-fg">Files</span>
        <span class="max-w-[40%] truncate font-mono text-[11px] text-muted" :title="paneCwd ?? ''">{{ paneCwd ?? "(default workspace)" }}</span>
      </template>
    </FilesPane>
  </div>
</template>
