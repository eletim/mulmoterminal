// Wire the "the server may have come back / we returned to the tab" signals to a
// self-heal callback, returning a cleanup that unregisters every listener. Kept out
// of RemoteHostControl.vue so the trigger wiring is unit-testable without mounting
// the Firebase-importing component (mirrors the remoteHostSession.ts split).
//
// The heal itself is a no-op when already connected, so firing a trigger spuriously
// only costs one status check — safe to over-trigger, never under-trigger.
//
// The event triggers alone leave a tab that just sits there open and visible with a
// status it fetched once on mount — the connection can die and the toolbar keeps showing
// the last thing it heard (#823). A slow tick keeps it honest and gives the parked-blob
// reconnect a chance to fire.
type OnReconnect = (cb: () => void) => () => void;

const POLL_MS = 30_000;

export function registerRemoteHostSelfHeal(heal: () => void, onReconnect: OnReconnect, pollMs: number = POLL_MS): () => void {
  const onOnline = () => heal();
  // A tab going hidden ALSO fires visibilitychange; only a return to visible warrants a heal.
  const onVisible = () => {
    if (document.visibilityState === "visible") heal();
  };
  const stopReconnect = onReconnect(heal);
  const ticker = setInterval(heal, pollMs);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    stopReconnect();
    clearInterval(ticker);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
