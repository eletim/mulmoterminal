import type { CalendarPushOutcome } from "@mulmoclaude/core/google";
import type { CollectionPushResult } from "../../common/collectionPush.js";

// Turn the engine's outcome into the one shape the collection view reads.
//
// Four of the five outcomes are "the push did not run", and all four have to arrive as
// `errors` on a 200 rather than as an HTTP failure: the view routes `!ok` to the page-level
// error slot, away from the button that was just pressed, while `errors` reaches the inline
// banner the plugin built for exactly this. Returning the counts alone would be worse still
// — "0 created" reads as "nothing to do" when the real answer is "link your account".

// Built per call, not shared: a caller that appends to `skipped` on one refusal must not
// find its entry on the next one.
const nothingPushed = () => ({ pushed: false, created: 0, updated: 0, conflicts: 0, localDeletes: 0, skipped: [] });

const refused = (reason: string): CollectionPushResult => ({ ...nothingPushed(), errors: [reason] });

export function toCollectionPushResult(outcome: CalendarPushOutcome): CollectionPushResult {
  switch (outcome.kind) {
    case "pushed": {
      const { created, updated, conflicts, localDeletes, skipped, errors } = outcome.result;
      return { pushed: true, created, updated, conflicts, localDeletes, skipped, errors };
    }
    // The view only shows the button for a collection whose schema declares a calendar, so
    // this is the direct-API path rather than something a click can reach.
    case "not-a-calendar":
      return refused("This collection does not declare a Google calendar.");
    case "not-linked":
      return refused("Google is not linked. Connect your account in Settings, then push again.");
    // Named rather than generic: "reader" vs "freeBusyReader" is the difference between
    // asking the owner for write access and having the wrong calendar entirely.
    case "read-only":
      return refused(`Your access to this calendar is read-only (${outcome.accessRole}).`);
    case "failed":
      return refused(outcome.message);
  }
}
