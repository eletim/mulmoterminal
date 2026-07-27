// Push a collection's records to the Google calendar its schema declares — the opposite
// direction from the feeds Refresh route next door, and deliberately a separate route: which
// way the data moved must never be ambiguous, and this direction writes to a calendar other
// people may read.
//
// A thin host adapter, like feeds.ts: @mulmoclaude/core/google owns the diffing, the shadow
// state and the Calendar writes (`pushCalendarForCollection`), and its deps default to the
// live ones, so the host supplies only the workspace and the wire shape. The Google host
// itself is configured once at boot by initGoogleBackend().
//
// The path and the gates mirror MulmoClaude's own calendar-push route
// (server/api/routes/collections.ts) — same plugin, same shared workspace, so the two hosts
// must not answer it differently.
//
//   POST /api/collections/:slug/calendar-push   →  CollectionPushResult
import type { Express, Request, Response } from "express";
import { pushCalendarForCollection } from "@mulmoclaude/core/google";
import { getWorkspaceRoot, loadCollection } from "@mulmoclaude/core/collection/server";
import { PUSH_NOT_DECLARED_ERROR, toCollectionPushResult } from "./calendarPushResult.js";
import { hostLogger } from "./hostLogger.js";

/** Injectable so the route's gates are testable without a workspace on disk or a live
 *  Google grant — the same shape `mountGoogleRoutes` uses for the same reason. Which
 *  failure is an HTTP status and which is a field on a 200 is this route's whole job, so
 *  it must not be reachable only through a real push. */
export interface CalendarPushRouteDeps {
  /** Any collection by slug — NOT the engine's calendar-only lookup, which cannot tell an
   *  undeclared collection from a missing one. Narrowed to what the gates actually read:
   *  a full `LoadedCollection` is a Zod-derived giant, and a route that needs one built to
   *  be tested is a route nobody tests. `loadCollection` satisfies this. */
  findCollection: (slug: string) => Promise<{ schema: { googleCalendar?: unknown } } | null>;
  push: typeof pushCalendarForCollection;
  workspaceRoot: () => string;
}

const liveDeps: CalendarPushRouteDeps = {
  findCollection: loadCollection,
  push: pushCalendarForCollection,
  // Read per request, not at mount: the collection host is configured after the routes go up.
  workspaceRoot: getWorkspaceRoot,
};

/** Mount POST /api/collections/:slug/calendar-push — backs the collection view's Push
 *  button (collectionUi.pushCalendarCollection). */
export function mountCalendarPushRoutes(app: Express, deps: CalendarPushRouteDeps = liveDeps): void {
  app.post("/api/collections/:slug/calendar-push", async (req: Request<{ slug: string }>, res: Response) => {
    const { slug } = req.params;
    try {
      const collection = await deps.findCollection(slug);
      if (!collection) {
        res.status(404).json({ error: `collection '${slug}' not found` });
        return;
      }
      // The view only shows the button for a collection that declares a calendar, so this
      // answers the direct-API caller rather than anything a click can reach.
      if (!collection.schema.googleCalendar) {
        res.status(400).json({ error: PUSH_NOT_DECLARED_ERROR });
        return;
      }
      // A push that could not run still answers 200 with the reason in `errors` — see
      // calendarPushResult.ts for why an HTTP failure would surface in the wrong place.
      const body = toCollectionPushResult(await deps.push(slug, deps.workspaceRoot()));
      hostLogger.info("calendar-push", "pushed via collection route", {
        slug,
        created: body.created,
        updated: body.updated,
        conflicts: body.conflicts,
        errors: body.errors.length,
      });
      res.json(body);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      hostLogger.warn("calendar-push", "push threw", { slug, error });
      res.status(500).json({ error });
    }
  });
}
