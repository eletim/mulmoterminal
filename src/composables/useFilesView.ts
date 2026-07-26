// Navigation seam for the full-screen file explorer + editor, a thin derivation over
// vue-router (mirrors usePrsView). The open view is the URL: /files?cwd=<project dir>.
// A terminal header's Files button opens it rooted at that terminal's directory.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";

// The view to return to when the Files view closes rides on the history entry (router
// state), NOT a module variable — so entering /files via browser back/forward restores
// that entry's own origin instead of a stale one, and a fresh/direct load falls back to
// chat. Reopening while already in Files (root change, or the guarded-close revert)
// carries the same origin forward.
const originFromHistory = (): string => {
  const origin = router.options.history.state.returnPath;
  // Resolved from the NAME, not written as "/": that path is the default-view entry and
  // now lands on the grid (#883). A string is still what comes back, because this value
  // is also stored in history state, which the check above reads back as a string.
  return typeof origin === "string" ? origin : router.resolve({ name: "chat" }).fullPath;
};

/** Open the Files view rooted at `cwd` (the terminal's project dir). */
export function filesGotoIndex(cwd: string | null): void {
  pushFilesRoute(cwd ? { cwd } : {});
}

/** Open the Files view rooted at `cwd` with `path` (project-relative) already open in the
 *  editor — what a clicked source path in terminal output does, so the file lands where the
 *  app can highlight and edit it instead of in a tab showing its bytes (#808). */
export function filesGotoFile(cwd: string | null, path: string): void {
  pushFilesRoute(cwd ? { cwd, path } : { path });
}

function pushFilesRoute(query: Record<string, string>): void {
  const alreadyOpen = router.currentRoute.value.name === "files";
  const returnPath = alreadyOpen ? originFromHistory() : router.currentRoute.value.fullPath;
  router.push({ name: "files", query, state: { returnPath } });
}

/** Close the Files view → back to the view it was opened from. */
export function filesClose(): void {
  router.push(originFromHistory());
}

export function useFilesView(): {
  isOpen: ComputedRef<boolean>;
  cwd: ComputedRef<string | null>;
  requestedPath: ComputedRef<string | null>;
  close: () => void;
} {
  return {
    isOpen: computed(() => router.currentRoute.value.name === "files"),
    // The project dir to browse — the ?cwd= query (a single string; arrays/absent => null).
    cwd: computed(() => queryString("cwd")),
    // A file to open on arrival — the ?path= query. The view owns what happens next; this
    // only reports what the URL asked for.
    requestedPath: computed(() => queryString("path")),
    close: filesClose,
  };
}

function queryString(name: string): string | null {
  const value = router.currentRoute.value.query[name];
  return typeof value === "string" && value !== "" ? value : null;
}
