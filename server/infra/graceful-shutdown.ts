import type { Server as HttpServer } from "node:http";
import { messageOf } from "../errors.js";

export interface GracefulShutdownDeps {
  server: HttpServer;
  stopSidecars: () => void;
  cleanupManagedLiveSessions: () => string[];
  closeRealtime: () => void;
  exit: (code: number) => never;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

function closeHttpServer(server: HttpServer, warn: (message: string) => void): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    server.close((err) => {
      if (err) warn(`[shutdown] HTTP server close reported: ${messageOf(err)}`);
      settle();
    });
    server.closeIdleConnections?.();
    setTimeout(() => {
      server.closeAllConnections?.();
      settle();
    }, 5_000).unref();
  });
}

export function createGracefulShutdown(deps: GracefulShutdownDeps): (signal: NodeJS.Signals) => Promise<void> {
  const log = deps.log ?? console.log;
  const warn = deps.warn ?? console.warn;
  let started = false;
  return async (signal) => {
    if (started) return;
    started = true;
    log(`[shutdown] received ${signal}; closing live sessions`);
    const closeServer = closeHttpServer(deps.server, warn);
    deps.stopSidecars();
    const cleaned = deps.cleanupManagedLiveSessions();
    if (cleaned.length) log(`[shutdown] cleaned ${cleaned.length} managed live session(s)`);
    deps.closeRealtime();
    await closeServer;
    deps.exit(0);
  };
}

export function installGracefulShutdown(deps: GracefulShutdownDeps): void {
  process.once("exit", deps.stopSidecars);
  const shutdown = createGracefulShutdown(deps);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void shutdown(signal));
}
