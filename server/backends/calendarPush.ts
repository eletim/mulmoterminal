// Push a collection's records to the Google calendar its schema declares — the opposite
// direction from the feeds Refresh route next door.
//
// A thin host adapter, like feeds.ts: @mulmoclaude/core/google owns the diffing, the shadow
// state and the Calendar writes (`pushCalendarForCollection`), and its deps default to the
// live ones, so the host supplies only the workspace and the wire shape. The Google host
// itself is configured once at boot by initGoogleBackend().
//
//   POST /api/collections/:slug/calendar/push   →  CollectionPushResult
import type { Express, Request, Response } from "express";
import { pushCalendarForCollection } from "@mulmoclaude/core/google";
import { getWorkspaceRoot } from "@mulmoclaude/core/collection/server";
import { toCollectionPushResult } from "./calendarPushResult.js";
import { hostLogger } from "./hostLogger.js";

/** Mount POST /api/collections/:slug/calendar/push — backs the collection view's
 *  Push button (collectionUi.pushCalendarCollection). No workspace argument: the
 *  collection host is already configured, so `getWorkspaceRoot()` answers. */
export function mountCalendarPushRoutes(app: Express): void {
  app.post("/api/collections/:slug/calendar/push", async (req: Request<{ slug: string }>, res: Response) => {
    const { slug } = req.params;
    try {
      // Every "could not run" reason travels as `errors` on this 200 — see
      // calendarPushResult.ts for why an HTTP failure would land in the wrong place.
      res.json(toCollectionPushResult(await pushCalendarForCollection(slug, getWorkspaceRoot())));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      hostLogger.warn("calendar-push", "push threw", { slug, error });
      res.status(500).json({ error });
    }
  });
}
