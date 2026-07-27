// The `POST /api/collections/:slug/calendar/push` response. The server builds it from the
// engine's outcome; the collection view reads it to say what the click did — both sides
// decide from it, so it lives here.
//
// Structurally the plugin's own `CollectionPushResult`, deliberately re-stated rather than
// imported: that type ships from `@mulmoclaude/collection-plugin/vue`, and the server has
// no business pulling a Vue package in to describe its own response.
//
// Note what is NOT here: an HTTP status. A push that could not run — no linked account, a
// read-only calendar — still answers 200 with the reason in `errors`, because that is the
// only path the view renders next to the button that was clicked.

export interface CollectionPushResult {
  /** False when nothing reached Google, whatever the reason. */
  pushed: boolean;
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
