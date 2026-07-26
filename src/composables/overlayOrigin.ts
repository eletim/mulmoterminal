// Where a full-screen overlay (collections / wiki / PRs / accounting / files) returns when it
// closes: the view it was opened from, rather than a fixed screen (#886).
//
// The origin rides the HISTORY ENTRY, not a module variable — so entering an overlay via
// browser back/forward restores that entry's own origin instead of a stale one, and a fresh
// or direct load has none and falls back. Navigating INSIDE an overlay carries the same
// origin forward.
import { router } from "../router";

/** The route an open overlay should return to. */
export function overlayReturnPath(): string {
  const origin = router.options.history.state.returnPath;
  // Resolved from the NAME rather than written as "/": that path is the default-view entry
  // and lands on the grid (#883). A string is what comes back, because this same value is
  // stored in history state, which the check above reads back as a string.
  return typeof origin === "string" ? origin : router.resolve({ name: "chat" }).fullPath;
}

/** The `state` to attach to an overlay's push. Entering captures the current view; moving
 *  around inside the overlay (index → detail, a ref hop, a tab) keeps the first origin. */
export function overlayOriginState(alreadyOpen: boolean): { returnPath: string } {
  return { returnPath: alreadyOpen ? overlayReturnPath() : router.currentRoute.value.fullPath };
}
