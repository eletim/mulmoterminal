<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { TerminalSnapshotState } from "../composables/useTerminalSnapshots";
import type { TerminalSessionSummary } from "../../common/terminalView";
import { agentBadge } from "../../common/sessionAgent";
import { formatCwd } from "./cwdDisplay";

const props = defineProps<{
  summary: TerminalSessionSummary;
  snapshot?: TerminalSnapshotState | undefined;
  expanded?: boolean;
  zoomed?: boolean;
  home?: string | null;
}>();

const emit = defineEmits<{ (e: "hide", sessionId: string): void; (e: "toggle-expand"): void }>();

const scroller = ref<HTMLElement | null>(null);
const autoscroll = ref(true);
const screen = computed(() => props.snapshot?.screen ?? "");
const meta = computed(() => props.snapshot?.meta ?? {});
const badge = computed(() => agentBadge(props.summary.agent)?.short ?? (props.summary.resume.kind === "launcher" ? "sh" : null));
const stateText = computed(() => {
  if (props.snapshot?.notFound) return "not found";
  if (props.snapshot?.loading && !props.snapshot.screen) return "loading";
  if (!props.snapshot?.screen) return "waiting for screen";
  if (props.snapshot.stale) return "stale";
  return props.summary.live ? "live" : "tmux";
});
const updated = computed(() => (props.snapshot?.updatedAt ? new Date(props.snapshot.updatedAt).toLocaleTimeString() : ""));
const cwd = computed(() => meta.value.cwd ?? props.summary.cwd);

function onScroll(): void {
  const el = scroller.value;
  if (!el) return;
  autoscroll.value = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
}

watch(
  screen,
  async () => {
    await nextTick();
    const el = scroller.value;
    if (el && autoscroll.value) el.scrollTop = el.scrollHeight;
  },
  { immediate: true },
);
</script>

<template>
  <section
    class="snapshot-cell flex min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-base text-fg"
    :class="{ 'ring-1 ring-accent': expanded, 'opacity-80': zoomed && !expanded }"
    data-testid="terminal-snapshot-cell"
    @dblclick="emit('toggle-expand')"
  >
    <header class="flex min-h-[34px] flex-none items-center gap-2 border-b border-border bg-panel px-2 text-[12px]">
      <span v-if="badge" class="flex-none rounded border border-border px-1 font-mono text-[10px] uppercase text-muted">{{ badge }}</span>
      <div class="min-w-0 flex-1">
        <div class="truncate font-semibold" :title="summary.title">{{ summary.title }}</div>
        <div class="truncate font-mono text-[10px] text-muted" :title="cwd">{{ formatCwd(cwd, home ?? null) }}</div>
      </div>
      <span v-if="meta.branch" class="hidden flex-none font-mono text-[10px] text-muted sm:inline">{{ meta.branch }}</span>
      <span class="flex-none font-mono text-[10px] text-muted" :title="updated">{{ stateText }}</span>
      <button
        type="button"
        class="flex h-[30px] w-[30px] flex-none items-center justify-center rounded border border-border text-muted hover:bg-hover hover:text-fg"
        :title="expanded ? 'Restore terminal' : 'Expand terminal'"
        :aria-label="expanded ? 'Restore terminal' : 'Expand terminal'"
        @click.stop="emit('toggle-expand')"
      >
        <span class="material-symbols-outlined text-[17px]" aria-hidden="true">{{ expanded ? "close_fullscreen" : "open_in_full" }}</span>
      </button>
      <button
        type="button"
        class="h-[30px] flex-none rounded border border-border px-2 text-[11px] text-muted hover:bg-hover hover:text-fg"
        title="Hide on this device"
        @click.stop="emit('hide', summary.id)"
      >
        Hide
      </button>
    </header>
    <div v-if="meta.memo || meta.summary || meta.prompt || snapshot?.error" class="flex-none space-y-0.5 border-b border-border bg-deep px-2 py-1 text-[11px]">
      <p v-if="meta.memo" class="truncate"><b class="mr-1 text-muted">memo</b>{{ meta.memo }}</p>
      <p v-if="meta.summary" class="truncate"><b class="mr-1 text-muted">summary</b>{{ meta.summary }}</p>
      <p v-if="meta.prompt" class="truncate"><b class="mr-1 text-muted">prompt</b>{{ meta.prompt }}</p>
      <p v-if="snapshot?.error" class="truncate text-warn"><b class="mr-1">screen</b>{{ snapshot.error }}</p>
    </div>
    <div ref="scroller" class="min-h-0 flex-1 overflow-auto overscroll-contain p-2 [touch-action:pan-x_pan-y]" @scroll="onScroll">
      <pre v-if="screen" class="m-0 min-w-max select-text whitespace-pre font-mono text-[12px] leading-[1.35] text-fg" data-testid="terminal-snapshot-screen">{{
        screen
      }}</pre>
      <div v-else class="flex h-full items-center justify-center text-[12px] text-muted" data-testid="terminal-snapshot-empty">
        {{ stateText }}
      </div>
    </div>
  </section>
</template>
