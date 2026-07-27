<script setup lang="ts">
// The full-screen Files view: FilesPane in a fixed frame, driven by the /files?cwd= route
// (useFilesView). Everything about browsing and editing lives in the pane — what is here is
// the route coupling, which the pane beside a zoomed grid cell does not have.
import { ref, watch } from "vue";
import { useFilesView, filesGotoIndex } from "../composables/useFilesView";
import FilesPane from "./FilesPane.vue";

const { isOpen, cwd, requestedPath, close } = useFilesView();

const pane = ref<InstanceType<typeof FilesPane> | null>(null);
const dirty = ref(false);
// `reverting`: a route change WE triggered to undo a declined leave/root-switch — skip
// its own watcher fire. `bypassGuard`: the close was already confirmed by the pane, so
// the watcher must not prompt again.
let reverting = false;
let bypassGuard = false;

// Guard any navigation that would drop the open buffer's unsaved edits. Same prompt the
// pane uses for its own actions, asked from the side that owns the route.
const confirmDiscard = (): boolean => !dirty.value || window.confirm("Discard unsaved changes?");

function onPaneClose(): void {
  bypassGuard = true; // the pane already confirmed — don't let the isOpen watcher prompt again
  close();
}

watch([isOpen, cwd], ([open, curCwd], prev) => {
  if (reverting) {
    reverting = false;
    return;
  }
  // Leaving the view (external nav / Back) OR changing root (?cwd=) mid-edit with unsaved
  // changes → confirm before discarding; declining restores the previous route (re-opens
  // /files at prevCwd) so the editor + buffer stay put.
  const wasOpen = prev?.[0] ?? false;
  const prevCwd = prev?.[1] ?? null;
  const leaving = wasOpen && !open;
  const rootChanged = open && curCwd !== prevCwd;
  if (!bypassGuard && (leaving || rootChanged) && !confirmDiscard()) {
    reverting = true;
    filesGotoIndex(prevCwd);
    return;
  }
  bypassGuard = false;
  // The pane is mounted per `isOpen`, so opening/closing already starts it fresh. A root
  // change keeps it mounted, and only THIS side knows the change survived the guard.
  if (open && wasOpen && rootChanged) pane.value?.reload();
});
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 bg-deep flex flex-col" role="region" aria-label="Files">
    <FilesPane ref="pane" :cwd="cwd" :requested-path="requestedPath" @close="onPaneClose" @dirty="dirty = $event">
      <template #title>
        <span class="text-[14px] font-[650] text-fg">Files</span>
        <span class="max-w-[40%] truncate font-mono text-[11px] text-muted" :title="cwd ?? ''">{{ cwd ?? "(default workspace)" }}</span>
      </template>
    </FilesPane>
  </div>
</template>
