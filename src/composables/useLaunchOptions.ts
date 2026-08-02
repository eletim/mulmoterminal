// The backends this server can launch a session on, for the launch picker (#584).
//
// Fetched once and shared: a full grid mounts a dozen empty cells at the same moment, and
// each one wants the same list. The answer only changes when the user edits config.json or
// restarts the server with a different environment, so `reloadLaunchOptions` is there for
// the settings screen rather than a poll.
import { ref } from "vue";
import type { LaunchOptions, LaunchProviderOption } from "../../common/launchOptions";
import { isRecord } from "../../common/isRecord";

import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";

// The picker renders a provider by id/label and launches by id, so a row missing either is
// dropped rather than shown as an unlabelled button that does nothing.
const isLaunchProviderOption = (row: unknown): row is LaunchProviderOption => isRecord(row) && typeof row.id === "string" && typeof row.label === "string";

const EMPTY: LaunchOptions = { providers: [], anyReady: false };
const FETCH_TIMEOUT_MS = 8000;

const options = ref<LaunchOptions>(EMPTY);
// The request currently in the air, so a grid mounting a dozen empty cells at once asks
// the server once. Cleared when it settles.
let inFlight: Promise<void> | null = null;
// Whether a fetch has actually SUCCEEDED. A failed one must not count: the first attempt
// can lose a race with a server that is still starting, and without this the picker would
// stay hidden for the rest of the page session even after the server came back.
let loaded = false;

async function fetchOptions(): Promise<void> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/launch-options", { signal: abort.signal });
    if (!res.ok) throw new Error(`GET /api/launch-options → ${res.status}`);
    const body = await jsonBody(res);
    // The picker branches on `anyReady` and lists `providers`; a body missing either shows an
    // empty picker rather than a broken one.
    options.value =
      isUnknownArray(body.providers) && typeof body.anyReady === "boolean"
        ? { providers: body.providers.filter(isLaunchProviderOption), anyReady: body.anyReady }
        : EMPTY;
    loaded = true;
  } catch (err) {
    // A picker that cannot load its list is not an error the user can act on — the launch
    // form still works and starts the session on the directory's own default. The next cell
    // to mount tries again.
    console.warn("[launch-options] falling back to the directory default:", err);
    options.value = EMPTY;
  } finally {
    clearTimeout(timer);
    // Cleared here rather than in a .finally() on the returned promise, so it is already
    // null by the time anything awaiting this call resumes.
    inFlight = null;
  }
}

const startFetch = (): Promise<void> => {
  inFlight = fetchOptions();
  return inFlight;
};

// Re-ask the server — for a settings screen that just changed what there is to offer.
export function reloadLaunchOptions(): Promise<void> {
  loaded = false;
  return startFetch();
}

export function useLaunchOptions() {
  if (!loaded && !inFlight) void startFetch();
  return { launchOptions: options };
}
