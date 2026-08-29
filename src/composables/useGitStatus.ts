// Polls GET /api/git-status for the active terminal's dir so its header can show branch / dirty /
// ahead·behind. Activation and cwd changes refresh immediately; focus and the shared 10s cadence
// refresh only while visible. `refresh` also observes `active`, so a background turn finishing
// cannot make an inactive cell fetch.
import { ref, type Ref } from "vue";
import type { GitStatus } from "../../common/gitStatus";
import { isRecord } from "../../common/isRecord";
import { useActiveRepoPolling } from "./useActiveRepoPolling";

const isGitStatus = (v: unknown): v is GitStatus => isRecord(v) && typeof v.repo === "boolean";

export function useGitStatus(cwd: Ref<string | null>, active: Ref<boolean>) {
  const status = ref<GitStatus | null>(null);
  let req = 0;

  async function refresh(): Promise<void> {
    // Bump the token BEFORE the early return: switching a cell to a dir-less state (e.g. a
    // launcher cell) must invalidate an in-flight fetch for the previous dir, or its late
    // response would apply `my === req` and put the old branch chip back. (#620.)
    const my = ++req;
    const dir = cwd.value;
    if (!dir) {
      status.value = null;
      return;
    }
    if (!active.value) return;
    try {
      const res = await fetch(`/api/git-status?cwd=${encodeURIComponent(dir)}`);
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (my === req) status.value = isGitStatus(data) ? data : null;
    } catch {
      // leave the last value; the next tick retries
    }
  }

  useActiveRepoPolling(refresh, active, [cwd], () => ++req);

  return { status, refresh };
}
