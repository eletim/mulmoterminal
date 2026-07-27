import type { CalendarPushOutcome } from "@mulmoclaude/core/google";
import type { CollectionPushResult } from "../../common/collectionPush.js";

// Shape the engine's outcome into the response the collection view reports on.
//
// Ports MulmoClaude's `calendarPushBody` (server/api/routes/collectionCalendarPush.ts),
// wording included: both hosts drive the same plugin over the same workspace, so a user
// who runs both must not get two different explanations for one setup problem.
//
// Every non-`pushed` outcome becomes an error rather than a quiet zero. The view routes an
// HTTP failure to the page-level error slot, away from the button that was pressed, and
// reads `errors` for the banner beside it — and counts alone would render "0 created",
// which says "nothing to do" when the real answer is "your account isn't linked".

export const PUSH_NOT_LINKED_ERROR = "no Google account is linked on this host — link it in Settings → Google";
export const PUSH_NOT_DECLARED_ERROR = "this collection does not declare a `googleCalendar` block, so there is no calendar to push to";

/** A `reader` grant fails per event with an opaque 403, so the role is checked once and
 *  reported as the setup problem it is. */
export const pushReadOnlyError = (accessRole: string): string =>
  `you only have ${accessRole || "read"} access to this calendar — pushing needs owner or writer access`;

// Built per call, not shared: a caller that appends to `skipped` on one refusal must not
// find its entry on the next one.
const empty = (errors: string[]): CollectionPushResult => ({ pushed: true, created: 0, updated: 0, conflicts: 0, localDeletes: 0, skipped: [], errors });

export function toCollectionPushResult(outcome: CalendarPushOutcome): CollectionPushResult {
  switch (outcome.kind) {
    case "pushed": {
      const { created, updated, conflicts, localDeletes, skipped, errors } = outcome.result;
      return { pushed: true, created, updated, conflicts, localDeletes, skipped, errors };
    }
    case "not-linked":
      return empty([PUSH_NOT_LINKED_ERROR]);
    // The route rejects an undeclared collection with a 400 before reaching the engine, so
    // this is the belt to that braces — kept because the engine can still answer it.
    case "not-a-calendar":
      return empty([PUSH_NOT_DECLARED_ERROR]);
    case "read-only":
      return empty([pushReadOnlyError(outcome.accessRole)]);
    case "failed":
      return empty([outcome.message]);
  }
}
