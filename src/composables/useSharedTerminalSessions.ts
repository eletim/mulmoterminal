import { computed, onBeforeUnmount, reactive, ref } from "vue";
import { isRecord } from "../../common/isRecord";
import { isTerminalSessionsResponse, type TerminalSessionSummary } from "../../common/terminalView";
import { usePubSub } from "./usePubSub";

const ROSTER_POLL_MS = 30_000;
const REFRESH_DEBOUNCE_MS = 250;

type Fetcher = typeof fetch;

type RosterMap = Map<string, TerminalSessionSummary>;

const applySessions = (sessions: RosterMap, rows: readonly TerminalSessionSummary[]): void => {
  const nextIds = new Set(rows.map((row) => row.id));
  for (const id of sessions.keys()) {
    if (!nextIds.has(id)) sessions.delete(id);
  }
  for (const row of rows) sessions.set(row.id, row);
};

const createRosterRefresh = (
  fetcher: Fetcher,
  sessions: RosterMap,
  loading: { value: boolean },
  error: { value: string | null },
  loaded: { value: boolean },
) => {
  let generation = 0;
  let inFlight: Promise<void> | null = null;

  const refresh = async (): Promise<void> => {
    if (inFlight) return inFlight;
    const req = ++generation;
    loading.value = true;
    inFlight = (async () => {
      try {
        const res = await fetcher("/api/terminal-sessions");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        if (req !== generation) return;
        if (!isTerminalSessionsResponse(body)) throw new Error("Invalid terminal session response");
        applySessions(sessions, body.sessions);
        error.value = null;
        loaded.value = true;
      } catch (err) {
        if (req === generation) error.value = err instanceof Error ? err.message : "Failed to load terminal sessions";
      } finally {
        if (req === generation) loading.value = false;
        inFlight = null;
      }
    })();
    return inFlight;
  };
  return refresh;
};

const sessionIdFromEvent = (data: unknown): string | null => (isRecord(data) && typeof data.id === "string" ? data.id : null);
const eventName = (data: unknown): string | null => (isRecord(data) && typeof data.event === "string" ? data.event : null);

export function useSharedTerminalSessions(fetcher: Fetcher = fetch) {
  const sessions = reactive(new Map<string, TerminalSessionSummary>());
  const loading = ref(false);
  const error = ref<string | null>(null);
  const loaded = ref(false);
  const refresh = createRosterRefresh(fetcher, sessions, loading, error, loaded);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let safetyTimer: ReturnType<typeof setInterval> | null = null;
  const requestRefresh = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS);
  };

  const { subscribe, onReconnect } = usePubSub();
  const offSessions = subscribe("sessions", (data) => {
    const event = eventName(data);
    if (event === "created" || event === "closed") {
      requestRefresh();
      return;
    }
    const id = sessionIdFromEvent(data);
    if (id && !sessions.has(id)) requestRefresh();
  });
  const offReconnect = onReconnect(requestRefresh);

  safetyTimer = setInterval(requestRefresh, ROSTER_POLL_MS);
  void refresh();

  onBeforeUnmount(() => {
    offSessions();
    offReconnect();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (safetyTimer) clearInterval(safetyTimer);
  });

  return {
    sessions,
    list: computed(() => [...sessions.values()]),
    loading,
    error,
    loaded,
    hasLoadedSuccessfully: loaded,
    refresh,
    requestRefresh,
  };
}
