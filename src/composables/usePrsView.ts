// Navigation seam for the cross-repo PR list view — a thin derivation over vue-router,
// mirroring useWikiBrowse / useAccountingView. The open view is entirely the URL:
// /prs = the PR list. The toolbar button and App's overlay read these.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";

/** Open the cross-repo PR list. */
export function prsGotoIndex(): void {
  router.push("/prs");
}

/** Close the PR view → back to chat. */
export function prsClose(): void {
  router.push({ name: "chat" });
}

export function usePrsView(): { isOpen: ComputedRef<boolean>; close: () => void } {
  return {
    isOpen: computed(() => router.currentRoute.value.name === "prs"),
    close: prsClose,
  };
}
