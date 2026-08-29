import { onBeforeUnmount, onMounted, watch, type Ref, type WatchSource } from "vue";

export const REPO_METADATA_POLL_MS = 10_000;

// Repo/header metadata belongs to the terminal the user is currently operating. Keep the
// lifecycle in one place so every endpoint has the same activation edge and, importantly, the
// same cleanup edge when focus moves to another cell.
export function useActiveRepoPolling(
  refresh: () => void | Promise<void>,
  active: Ref<boolean>,
  sources: WatchSource<unknown>[] = [],
  onDeactivate?: () => void,
): void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const refreshIfVisible = () => {
    if (active.value && document.visibilityState === "visible") void refresh();
  };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const sync = () => {
    stop();
    if (!active.value) {
      onDeactivate?.();
      return;
    }
    refreshIfVisible();
    timer = setInterval(refreshIfVisible, REPO_METADATA_POLL_MS);
  };

  onMounted(() => {
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    sync();
  });
  // One watcher avoids a cwd/session update that accompanies activation causing two immediate
  // requests. Resetting the interval also makes the next regular tick a full 10s after the new
  // session's immediate refresh.
  watch([active, ...sources], sync, { flush: "sync" });
  onBeforeUnmount(() => {
    stop();
    onDeactivate?.();
    window.removeEventListener("focus", refreshIfVisible);
    document.removeEventListener("visibilitychange", refreshIfVisible);
  });
}
