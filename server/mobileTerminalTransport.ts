import type { Express } from "express";
import type { MobileMode } from "../common/mobileMode.js";
import { mountMobileTransport } from "./mobileTransportMount.js";
import { mountLocalMobileTerminalRoutes, type LocalMobileTerminalRouteDeps } from "./routes/local-mobile-terminal-routes.js";
import type { RemoteHostBackendDeps, RemoteHostRouteOptions } from "./backends/remoteHost/index.js";

type LocalMobileExtras = Pick<
  LocalMobileTerminalRouteDeps,
  "captureStyledScreen" | "createTerminalAtCwd" | "activityOf" | "workPhaseOf" | "setWaiting" | "mobileWebPush"
>;

export function mountConfiguredMobileTransport({
  mode,
  app,
  isAllowedOrigin,
  remoteHostDeps,
  localExtras,
  initRemote,
  mountRemoteRoutes,
}: {
  mode: MobileMode;
  app: Express;
  isAllowedOrigin: LocalMobileTerminalRouteDeps["isAllowedOrigin"];
  remoteHostDeps: RemoteHostBackendDeps;
  localExtras: LocalMobileExtras;
  initRemote: (deps: RemoteHostBackendDeps) => void;
  mountRemoteRoutes: (app: Express, deps: RemoteHostRouteOptions) => void;
}): void {
  mountMobileTransport({
    mode,
    mountRemote: () => {
      initRemote(remoteHostDeps);
      mountRemoteRoutes(app, { isAllowedOrigin });
    },
    mountLocal: () => {
      mountLocalMobileTerminalRoutes(app, { isAllowedOrigin, ...remoteHostDeps, ...localExtras });
    },
  });
}
