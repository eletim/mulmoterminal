<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import TerminalView from "./Terminal.vue";
import CellShell from "./CellShell.vue";
import { cellShellEvents } from "./cellChromeBinding";
import { isShellLauncher, type CellLauncher } from "./gridTabs";
import type { GridCellEmits, GridCellProps } from "./gridCell";
import { CELL_BTN, CELL_TERM } from "./cellChromeClasses";
import { useConfirmedSessionDelete } from "../composables/useConfirmedSessionDelete";

// A grid cell running a configured launch command (a plain shell, codex, any
// interactive program) instead of Claude. Unlike CommandCell this is PERSISTENT: it
// carries a session id and a durable connection (persistKey), so it survives page
// switches and reconnects — but it has no Claude hooks, so its status is only
// running (working) / exited (idle). `launcher.index` is the command's position in the
// configured launcher list (the server's allowlist); it runs in `cwd`.
//
// The frame, header and chrome buttons come from CellShell, which CommandCell shares.
const props = defineProps<
  GridCellProps & {
    uid: number;
    launcher: CellLauncher;
    session: string | null;
    cwd: string | null;
    // Manual sort mode: show move buttons to swap this cell with its neighbour.
    reorderable?: boolean;
  }
>();
const emit = defineEmits<
  GridCellEmits & {
    // The server-assigned session id, so the parent persists it for reconnect.
    (e: "session", id: string): void;
  }
>();

const termRef = useTemplateRef<InstanceType<typeof TerminalView>>("termRef");
const sessionId = ref(props.session);
watch(
  () => props.session,
  (id) => (sessionId.value = id),
);
const { deletePending, deleteError, deleteAfterConfirmation, sessionIdAvailable, cancelAwaitingDelete } = useConfirmedSessionDelete({
  sessionId,
  setInputEnabled: (enabled) => termRef.value?.setInputEnabled(enabled),
});

function closePersistentSession() {
  deleteAfterConfirmation(() => {
    termRef.value?.releaseConnection();
    emit("close");
  });
}

// Unlike CommandCell's local close, a launcher close cannot be forwarded to the grid: Shell and
// configured launchers own persistent Core membership even after their process has exited.
const shellEvents = cellShellEvents(emit, closePersistentSession);

// connectKey bump re-launches after the process exits (relaunch button).
const connectKey = ref(0);
const finished = ref(false);

const target = computed(() => (isShellLauncher(props.launcher) ? { shell: true as const } : { index: props.launcher.index }));

// Running counts as "working"; once the process exits it's idle (never "waiting").
watch(finished, (done) => emit("status", done ? "idle" : "working"), { immediate: true });

function onSession(id: string) {
  sessionId.value = id;
  emit("session", id);
  sessionIdAvailable();
}
function onExit() {
  finished.value = true;
  if (!sessionId.value && deletePending.value) {
    cancelAwaitingDelete();
    termRef.value?.releaseConnection();
    emit("close");
  }
}
function relaunch() {
  finished.value = false;
  connectKey.value++;
}
</script>

<template>
  <CellShell
    :expanded="expanded"
    :files-open="filesOpen"
    :right-pane="rightPane"
    :canvas-available="canvasAvailable"
    :home="home"
    :cwd="cwd"
    :finished="finished"
    idle-title="Exited"
    icon="rocket_launch"
    :label="launcher.label"
    move-noun="launcher"
    :reorderable="reorderable"
    v-on="shellEvents"
  >
    <template #actions>
      <button v-if="finished" class="cell-btn" :class="CELL_BTN" title="Relaunch" aria-label="Relaunch" @click="relaunch">
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
      </button>
    </template>
    <TerminalView
      ref="termRef"
      class="cell-term"
      :class="CELL_TERM"
      :persist-key="`cell-${uid}`"
      :session-id="session"
      :connect-key="connectKey"
      :cwd="cwd"
      :launcher="target"
      :expanded="expanded"
      :zoomed="zoomed"
      @session="onSession"
      @exit="onExit"
    />
    <div
      v-if="deletePending"
      data-testid="cell-deleting"
      class="absolute inset-0 z-[40] flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-base)_72%,transparent)]"
      role="status"
      aria-live="polite"
      aria-label="Deleting terminal"
    >
      <div
        class="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 font-sans text-[12px] text-secondary shadow-[0_6px_18px_rgba(0,0,0,0.35)]"
      >
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden="true" />
        Deleting terminal…
      </div>
    </div>
    <p
      v-else-if="deleteError"
      data-testid="cell-delete-error"
      class="absolute inset-x-2 bottom-2 z-[35] m-0 rounded-md border border-err-text bg-[var(--err-deep)] px-3 py-2 font-sans text-[12px] text-err-text shadow-[0_6px_18px_rgba(0,0,0,0.35)]"
      role="alert"
    >
      {{ deleteError }} Retry with ×.
    </p>
  </CellShell>
</template>
