// Navigation seam for the cross-repo PR list view — a thin derivation over vue-router,
// mirroring useWikiBrowse / useAccountingView. The open view is entirely the URL:
// /prs = the PR list. The toolbar button and App's overlay read these.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";

/** Open the cross-repo PR list. */
export function prsGotoIndex(): void {
  router.push({ path: "/prs", state: overlayOriginState(isPrsRoute()) });
}

// Which routes count as "already inside this overlay", so a re-open keeps the origin it
// was first entered with instead of recording the overlay itself as the return target.
function isPrsRoute(): boolean {
  return router.currentRoute.value.name === "prs";
}

/** Close the PR view → back to the view it was opened from. */
export function prsClose(): void {
  router.push(overlayReturnPath());
}

export function usePrsView(): { isOpen: ComputedRef<boolean>; close: () => void } {
  return {
    isOpen: computed(() => router.currentRoute.value.name === "prs"),
    close: prsClose,
  };
}
