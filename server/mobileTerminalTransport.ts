import type { Express } from "express";
import { mountLocalMobileTerminalRoutes, type LocalMobileTerminalRouteDeps } from "./routes/local-mobile-terminal-routes.js";

type LocalMobileExtras = Pick<
  LocalMobileTerminalRouteDeps,
  "captureStyledScreen" | "createTerminalAtCwd" | "activityOf" | "workPhaseOf" | "setWaiting" | "mobileWebPush"
>;

type LocalMobileCoreDeps = Omit<LocalMobileTerminalRouteDeps, keyof LocalMobileExtras | "isAllowedOrigin">;

export function mountConfiguredMobileTransport({
  app,
  isAllowedOrigin,
  terminalDeps,
  localExtras,
}: {
  app: Express;
  isAllowedOrigin: LocalMobileTerminalRouteDeps["isAllowedOrigin"];
  terminalDeps: LocalMobileCoreDeps;
  localExtras: LocalMobileExtras;
}): void {
  mountLocalMobileTerminalRoutes(app, { isAllowedOrigin, ...terminalDeps, ...localExtras });
}
