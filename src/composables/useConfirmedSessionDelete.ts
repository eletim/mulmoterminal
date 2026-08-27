import { computed, ref, type Ref } from "vue";
import { jsonBody } from "../jsonBody";

type AfterConfirmedDelete = () => void | Promise<void>;

interface DeleteRequestState {
  deleting: Ref<boolean>;
  deleteError: Ref<string | null>;
}

export interface ConfirmedSessionDeleteOptions {
  /** The persistent Core membership id. Process exit does not clear this id. */
  sessionId: Readonly<Ref<string | null>>;
  /** Gate the durable viewer while Delete is pending; this is UI state, not Backend lifecycle. */
  setInputEnabled: (enabled: boolean) => void;
}

async function requestConfirmedCoreDelete(options: ConfirmedSessionDeleteOptions, state: DeleteRequestState): Promise<boolean> {
  const id = options.sessionId.value;
  if (state.deleting.value || !id) return false;
  state.deleting.value = true;
  state.deleteError.value = null;
  options.setInputEnabled(false);
  try {
    const response = await fetch(`/api/session/${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await jsonBody(response);
    if (!response.ok || body.deleted !== true) {
      const detail = typeof body.error === "string" ? `: ${body.error}` : "";
      throw new Error(`Couldn't delete this terminal${detail}. It remains open.`);
    }
    return true;
  } catch (error) {
    state.deleting.value = false;
    options.setInputEnabled(true);
    if (error instanceof TypeError) state.deleteError.value = "Couldn't reach the server. This terminal was not deleted.";
    else if (error instanceof Error) state.deleteError.value = error.message;
    else state.deleteError.value = "Couldn't delete this terminal. It remains open.";
    return false;
  }
}

/**
 * The one browser-side destructive contract for every persistent Core-session cell.
 *
 * Presentation (Working confirmation, worktree choices, relaunch controls) stays in the cell.
 * This owner serializes DELETE, waits for `{ deleted: true }`, and preserves the cell on failure.
 * A fresh launch can be closed before its server-assigned id arrives; the same requested action is
 * resumed by `sessionIdAvailable` instead of releasing a viewer that may already own membership.
 */
export function useConfirmedSessionDelete(options: ConfirmedSessionDeleteOptions) {
  const deleting = ref(false);
  const awaitingSessionIdForDelete = ref(false);
  const deleteError = ref<string | null>(null);
  const deletePending = computed(() => deleting.value || awaitingSessionIdForDelete.value);
  let afterConfirmedDelete: AfterConfirmedDelete | null = null;
  const requestCoreDelete = () => requestConfirmedCoreDelete(options, { deleting, deleteError });

  async function finishRequestedDelete(): Promise<void> {
    const completion = afterConfirmedDelete;
    if (!completion || !(await requestCoreDelete())) return;
    afterConfirmedDelete = null;
    await completion();
  }

  function deleteAfterConfirmation(onDeleted: AfterConfirmedDelete): void {
    if (deletePending.value) return;
    afterConfirmedDelete = onDeleted;
    deleteError.value = null;
    if (!options.sessionId.value) {
      awaitingSessionIdForDelete.value = true;
      options.setInputEnabled(false);
      return;
    }
    void finishRequestedDelete();
  }

  function sessionIdAvailable(): void {
    if (!awaitingSessionIdForDelete.value || !options.sessionId.value) return;
    awaitingSessionIdForDelete.value = false;
    void finishRequestedDelete();
  }

  function cancelAwaitingDelete(): void {
    if (!awaitingSessionIdForDelete.value) return;
    awaitingSessionIdForDelete.value = false;
    afterConfirmedDelete = null;
  }

  function resetDeleteState(): void {
    deleting.value = false;
    awaitingSessionIdForDelete.value = false;
    deleteError.value = null;
    afterConfirmedDelete = null;
  }

  return {
    deleting,
    awaitingSessionIdForDelete,
    deletePending,
    deleteError,
    requestCoreDelete,
    deleteAfterConfirmation,
    sessionIdAvailable,
    cancelAwaitingDelete,
    resetDeleteState,
  };
}
