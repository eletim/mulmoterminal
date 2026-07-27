<script setup lang="ts">
// The full-screen Files view: FilesPane in a fixed frame, driven by the /files?cwd= route
// (useFilesView). Everything about browsing and editing lives in the pane — what is here is
// the route coupling, which the pane beside a zoomed grid cell does not have.
import { ref, watch } from "vue";
import { useFilesView } from "../composables/useFilesView";
import FilesPane from "./FilesPane.vue";

const { isOpen, cwd, requestedPath, close } = useFilesView();

const pane = ref<InstanceType<typeof FilesPane> | null>(null);

// Leaving the view (external nav / Back) or changing root (?cwd=) is leaving the open file, so
// the buffer is saved rather than asked about — the same bargain the pane makes everywhere
// else. The watcher runs before the re-render that unmounts the pane, and flush() reads the
// document synchronously, so the content is captured even on the way out.
watch([isOpen, cwd], ([open, curCwd], prev) => {
  const wasOpen = prev?.[0] ?? false;
  const rootChanged = open && curCwd !== (prev?.[1] ?? null);
  if (!wasOpen) return;
  if (!open || rootChanged) pane.value?.flush();
  // A root change keeps the pane mounted, and only this side knows the change happened.
  if (rootChanged) pane.value?.reload();
});
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 bg-deep flex flex-col" role="region" aria-label="Files">
    <FilesPane ref="pane" :cwd="cwd" :requested-path="requestedPath" @close="close">
      <template #title>
        <span class="text-[14px] font-[650] text-fg">Files</span>
        <span class="max-w-[40%] truncate font-mono text-[11px] text-muted" :title="cwd ?? ''">{{ cwd ?? "(default workspace)" }}</span>
      </template>
    </FilesPane>
  </div>
</template>
