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

// There is no PR #0 and no negative issue: a stale or malformed response saying so must render
// nothing rather than an impossible link (found by CodeRabbit review).
const numberOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);

// These go straight into an `<a href>`, so the scheme is not the response's decision to make:
// `javascript:` in that attribute runs on click. https only — github.com and GitHub Enterprise
// both serve it, and the cost of refusing anything else is a missing hyperlink next to a number
// that still shows (found by Codex review).
const safeHttpsUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || v === "") return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
};

// The server is the only writer of this shape, but it is a network response: an old build, a
// proxy returning HTML, or a half-deployed server would otherwise put `undefined` in the chip.
export function parseWorkItem(data: unknown): WorkItem {
  if (!isRecord(data) || !isPrPhase(data.phase)) return { ...EMPTY_WORK_ITEM };
  return {
    phase: data.phase,
    pr: numberOrNull(data.pr),
    prUrl: safeHttpsUrl(data.prUrl),
    issue: numberOrNull(data.issue),
    issueUrl: safeHttpsUrl(data.issueUrl),
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
    // Switching browser TABS fires this and not `focus`, and at a 30s cadence a returning tab
    // would otherwise show the previous PR state for most of a minute (CodeRabbit review).
    document.addEventListener("visibilitychange", refreshIfVisible);
    timer = setInterval(refreshIfVisible, POLL_MS);
  });
  onUnmounted(() => {
    window.removeEventListener("focus", refreshIfVisible);
    document.removeEventListener("visibilitychange", refreshIfVisible);
    if (timer) clearInterval(timer);
  });
  watch(cwd, () => void refresh());

  return { item, refresh };
}
