// What this cell is working on — the branch's PR and the issue behind it — for the header chip.
// Same shape of poll as useGitStatus (mount, cwd change, window focus, a light interval while
// visible), because it answers the same question about the same directory and a user who commits
// or opens a PR expects both chips to catch up together.
//
// The interval is slow on purpose: the server caches each (repo, branch) answer for 30s and the
// call behind it shells out to `gh`, so polling faster buys nothing but subprocesses.
import { ref, watch, onMounted, onUnmounted, type Ref } from "vue";
import { EMPTY_WORK_ITEM, isPrPhase, type WorkItem } from "../../common/prPhase";
import { isRecord } from "../../common/isRecord";

const POLL_MS = 30_000;

const numberOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const stringOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

// The server is the only writer of this shape, but it is a network response: an old build, a
// proxy returning HTML, or a half-deployed server would otherwise put `undefined` in the chip.
export function parseWorkItem(data: unknown): WorkItem {
  if (!isRecord(data) || !isPrPhase(data.phase)) return { ...EMPTY_WORK_ITEM };
  return {
    phase: data.phase,
    pr: numberOrNull(data.pr),
    prUrl: stringOrNull(data.prUrl),
    issue: numberOrNull(data.issue),
    issueUrl: stringOrNull(data.issueUrl),
  };
}

// Nothing to show: no PR, no issue — or the PR is merged, which is the point at which the cell
// has stopped working on it (#979). A closed PR reads the same way.
export function hasWorkToShow(item: WorkItem): boolean {
  if (item.phase === "merged" || item.phase === "closed") return false;
  return item.pr !== null || item.issue !== null;
}

export function useWorkItem(cwd: Ref<string | null>) {
  const item = ref<WorkItem>({ ...EMPTY_WORK_ITEM });
  let req = 0;

  async function refresh(): Promise<void> {
    // Bumped before the early return for the same reason as useGitStatus: a cell losing its dir
    // must invalidate an in-flight fetch, or the previous dir's PR reappears in the header.
    const my = ++req;
    const dir = cwd.value;
    if (!dir) {
      item.value = { ...EMPTY_WORK_ITEM };
      return;
    }
    try {
      const res = await fetch(`/api/pr-phase?cwd=${encodeURIComponent(dir)}`);
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (my === req) item.value = parseWorkItem(data);
    } catch {
      // leave the last value; the next tick retries
    }
  }

  const refreshIfVisible = () => {
    if (document.visibilityState === "visible") void refresh();
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    void refresh();
    window.addEventListener("focus", refreshIfVisible);
    timer = setInterval(refreshIfVisible, POLL_MS);
  });
  onUnmounted(() => {
    window.removeEventListener("focus", refreshIfVisible);
    if (timer) clearInterval(timer);
  });
  watch(cwd, () => void refresh());

  return { item, refresh };
}
