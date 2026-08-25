import type { Express } from "express";
import { requestOriginAllowed } from "../routes/same-origin-guard.js";
import { messageOf } from "../errors.js";

export interface TmuxRouteDeps {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  isValidSessionId: (id: string) => boolean;
  deleteSession: (id: string) => Promise<void>;
}

/** Compatibility route for the Desktop close button. Core.delete() is the only membership write. */
export function mountTmuxRoutes(app: Express, deps: TmuxRouteDeps): void {
  app.post("/api/session/:id/terminate", async (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const id = req.params.id;
    if (!deps.isValidSessionId(id)) return res.status(400).json({ error: "invalid session id" });
    try {
      await deps.deleteSession(id);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(409).json({ error: messageOf(error) });
    }
  });
}
