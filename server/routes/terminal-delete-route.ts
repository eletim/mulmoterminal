import type { Express } from "express";
import { messageOf } from "../errors.js";
import { requestOriginAllowed } from "./same-origin-guard.js";

export interface TerminalDeleteRouteDeps {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  isValidSessionId: (id: string) => boolean;
  deleteSession: (id: string) => Promise<void>;
}

/** Request/response Delete for the Desktop cell close button. Core.delete() is the only membership write. */
export function mountTerminalDeleteRoute(app: Express, deps: TerminalDeleteRouteDeps): void {
  app.delete("/api/session/:id", async (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const id = req.params.id;
    if (!deps.isValidSessionId(id)) return res.status(400).json({ error: "invalid session id" });
    try {
      await deps.deleteSession(id);
      return res.json({ deleted: true });
    } catch (error) {
      return res.status(409).json({ error: messageOf(error) });
    }
  });
}
