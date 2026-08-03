import { computed, onBeforeUnmount, reactive, watch, type Ref } from "vue";
import { isTerminalSessionScreen, type TerminalSessionScreen } from "../../common/terminalView";

const SNAPSHOT_POLL_MS = 1500;
const MAX_CONCURRENT = 3;

export interface TerminalSnapshotState {
  screen: string | null;
  meta: Omit<TerminalSessionScreen, "screen" | "suggestion" | "quickCommands">;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  stale: boolean;
  updatedAt: number | null;
  inFlight: boolean;
  generation: number;
}

const emptyMeta = (): TerminalSnapshotState["meta"] => ({});

const snapshotState = (): TerminalSnapshotState => ({
  screen: null,
  meta: emptyMeta(),
  loading: false,
  error: null,
  notFound: false,
  stale: false,
  updatedAt: null,
  inFlight: false,
  generation: 0,
});

type Fetcher = typeof fetch;

interface TerminalSnapshotsOptions {
  viewer: Ref<boolean>;
  visibleSessionIds: Ref<readonly string[]>;
  onMissingSession?: (sessionId: string) => void;
  fetcher?: Fetcher;
}

interface SnapshotRuntime {
  fetcher: Fetcher;
  snapshots: Map<string, TerminalSnapshotState>;
  options: TerminalSnapshotsOptions;
  visibleIds: Ref<string[]>;
  queue: string[];
  timer: ReturnType<typeof setInterval> | null;
  active: number;
}

const ensureSnapshot = (ctx: SnapshotRuntime, id: string): TerminalSnapshotState => {
  let state = ctx.snapshots.get(id);
  if (!state) {
    state = snapshotState();
    ctx.snapshots.set(id, state);
  }
  return state;
};

const screenMeta = (screen: TerminalSessionScreen): TerminalSnapshotState["meta"] => ({
  ...(screen.cwd !== undefined ? { cwd: screen.cwd } : {}),
  ...(screen.branch !== undefined ? { branch: screen.branch } : {}),
  ...(screen.memo !== undefined ? { memo: screen.memo } : {}),
  ...(screen.summary !== undefined ? { summary: screen.summary } : {}),
  ...(screen.prompt !== undefined ? { prompt: screen.prompt } : {}),
  ...(screen.githubUrl !== undefined ? { githubUrl: screen.githubUrl } : {}),
});

const applyNotFound = (ctx: SnapshotRuntime, id: string, state: TerminalSnapshotState): void => {
  state.notFound = true;
  state.error = "terminal session not found";
  state.stale = state.screen !== null;
  ctx.options.onMissingSession?.(id);
};

const fetchSnapshot = async (ctx: SnapshotRuntime, id: string): Promise<void> => {
  const state = ensureSnapshot(ctx, id);
  if (state.inFlight) return;
  const gen = state.generation + 1;
  state.generation = gen;
  state.inFlight = true;
  state.loading = state.screen === null;
  try {
    const res = await ctx.fetcher(`/api/terminal-sessions/${encodeURIComponent(id)}/screen`);
    if (state.generation !== gen) return;
    if (res.status === 404) return applyNotFound(ctx, id, state);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (state.generation !== gen) return;
    if (!isTerminalSessionScreen(body)) throw new Error("Invalid terminal screen response");
    state.screen = body.screen;
    state.meta = screenMeta(body);
    state.error = null;
    state.notFound = false;
    state.stale = false;
    state.updatedAt = Date.now();
  } catch (err) {
    if (state.generation !== gen) return;
    state.error = err instanceof Error ? err.message : "Failed to load terminal screen";
    state.stale = state.screen !== null;
  } finally {
    if (state.generation === gen) {
      state.loading = false;
      state.inFlight = false;
    }
  }
};

const pumpSnapshots = (ctx: SnapshotRuntime): void => {
  while (ctx.active < MAX_CONCURRENT && ctx.queue.length > 0) {
    const id = ctx.queue.shift();
    if (!id) continue;
    ctx.active++;
    void fetchSnapshot(ctx, id).finally(() => {
      ctx.active--;
      pumpSnapshots(ctx);
    });
  }
};

const requestSnapshots = (ctx: SnapshotRuntime, ids: readonly string[] = ctx.visibleIds.value): void => {
  if (!ctx.options.viewer.value || document.hidden) return;
  for (const id of ids) {
    const state = ensureSnapshot(ctx, id);
    if (state.inFlight || ctx.queue.includes(id)) continue;
    ctx.queue.push(id);
  }
  pumpSnapshots(ctx);
};

const stopSnapshots = (ctx: SnapshotRuntime): void => {
  if (ctx.timer) clearInterval(ctx.timer);
  ctx.timer = null;
  ctx.queue.length = 0;
};

const syncSnapshots = (ctx: SnapshotRuntime): void => {
  const keep = new Set(ctx.visibleIds.value);
  for (const id of ctx.snapshots.keys()) {
    if (!keep.has(id)) ctx.snapshots.delete(id);
  }
  stopSnapshots(ctx);
  if (!ctx.options.viewer.value || document.hidden) return;
  requestSnapshots(ctx);
  ctx.timer = setInterval(() => requestSnapshots(ctx), SNAPSHOT_POLL_MS);
};

export function useTerminalSnapshots(options: TerminalSnapshotsOptions) {
  const snapshots = reactive(new Map<string, TerminalSnapshotState>());
  const visibleIds = computed(() => [...new Set(options.visibleSessionIds.value)].filter(Boolean));
  const ctx: SnapshotRuntime = { fetcher: options.fetcher ?? fetch, snapshots, options, visibleIds, queue: [], timer: null, active: 0 };
  const request = (ids?: readonly string[]): void => requestSnapshots(ctx, ids);
  const sync = (): void => syncSnapshots(ctx);
  const onVisibility = (): void => (document.hidden ? stopSnapshots(ctx) : sync());

  document.addEventListener("visibilitychange", onVisibility);
  watch([options.viewer, visibleIds], sync, { immediate: true });
  onBeforeUnmount(() => {
    stopSnapshots(ctx);
    document.removeEventListener("visibilitychange", onVisibility);
  });

  return { snapshots, request, pollMs: SNAPSHOT_POLL_MS, maxConcurrent: MAX_CONCURRENT };
}
