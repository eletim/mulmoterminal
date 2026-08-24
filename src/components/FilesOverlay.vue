<script setup lang="ts">
// The full-screen Files view: FilesPane in a fixed frame, driven by the /files?cwd= route
// (useFilesView). Everything about browsing lives in the pane — what is here is
// the route coupling, which the pane beside a zoomed grid cell does not have.
import { nextTick, ref, watch } from "vue";
import { useFilesView } from "../composables/useFilesView";
import FilesPane from "./FilesPane.vue";

const { isOpen, cwd, requestedPath, close } = useFilesView();

const pane = ref<InstanceType<typeof FilesPane> | null>(null);
const paneCwd = ref<string | null>(cwd.value);

watch([isOpen, cwd], async ([open, curCwd], prev) => {
  const wasOpen = prev?.[0] ?? false;
  if (!wasOpen) {
    paneCwd.value = curCwd;
    return;
  }
  const rootChanged = open && curCwd !== (prev?.[1] ?? null);
  if (!rootChanged) return;
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
