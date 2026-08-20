// GET /api/mobile-mode — read-only. External-server remote mode has been removed; the response
// stays as a small compatibility shape for the mobile page.
import type { Express, Request, Response } from "express";
import { MOBILE_MODE } from "../config/env.js";

export function mountMobileModeRoute(app: Express): void {
  app.get("/api/mobile-mode", (_req: Request, res: Response) => {
    res.json({ mode: MOBILE_MODE });
  });
}
