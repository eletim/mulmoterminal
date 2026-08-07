// GET /api/mobile-mode — read-only, always mounted regardless of MULMOTERMINAL_MOBILE_MODE, so
// the frontend (a later phase) can tell which mobile transport this server was started with.
// Deliberately carries nothing about Firebase connection state — that stays behind
// /api/remote-host/status, which is not even mounted in local mode (server/index.ts).
import type { Express, Request, Response } from "express";
import { MOBILE_MODE } from "../config/env.js";

export function mountMobileModeRoute(app: Express): void {
  app.get("/api/mobile-mode", (_req: Request, res: Response) => {
    res.json({ mode: MOBILE_MODE });
  });
}
