// The `POST /api/collections/:slug/calendar-push` response. The server builds it from the
// engine's outcome; the collection view reads it to say what the click did — both sides
// decide from it, so it lives here.
//
// The shape (and the route's path) mirrors MulmoClaude's `CollectionPushBody`
// (server/api/routes/collectionCalendarPush.ts) so the two hosts over the shared workspace
// answer the same plugin identically. Re-stated rather than imported: the plugin ships its
// `CollectionPushResult` from `@mulmoclaude/collection-plugin/vue`, and the server has no
// business pulling a Vue package in to describe its own response.

export interface CollectionPushResult {
  /** Always true — "the push ran", not "records moved". The plugin's own type widens this
   *  to `boolean` but never reads it, and MulmoClaude pins it to `true`; a refusal is told
   *  through `errors`, so the two hosts stay identical on a field neither of them uses. */
  pushed: true;
  created: number;
  updated: number;
  /** Edited on both sides; skipped so neither version is destroyed. */
  conflicts: number;
  /** Deleted locally. Reported only — a push never deletes in Google. */
  localDeletes: number;
  /** Records that could not be pushed as they stand, each with its reason. */
  skipped: string[];
  /** Why the push as a whole did not do what was asked. */
  errors: string[];
}
