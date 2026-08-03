import type { Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import {
  TERMINAL_CONTROL_ACQUIRE_EVENT,
  TERMINAL_CONTROL_ERROR_EVENT,
  TERMINAL_CONTROL_IDENTIFY_EVENT,
  TERMINAL_CONTROL_RELEASE_EVENT,
  TERMINAL_CONTROL_SOCKET_PATH,
  TERMINAL_CONTROL_STATE_EVENT,
  normalizeTerminalControlIdentity,
  type TerminalControlError,
  type TerminalControlState,
} from "../../common/terminalControl.js";
import { createTerminalControlLease, type TerminalControlLease, type TerminalControlLeaseDeps } from "./terminal-control-lease.js";

export interface TerminalControlServerDeps {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  leaseDeps?: TerminalControlLeaseDeps;
}

export interface TerminalControlServer {
  isOwnerInstance(instanceId: string): boolean;
  close(): Promise<void>;
}

const defaultLeaseDeps = (): TerminalControlLeaseDeps => ({
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle),
});

const notIdentifiedError = (): TerminalControlError => ({ code: "not_identified", message: "identify before using terminal control" });
const invalidIdentityError = (): TerminalControlError => ({ code: "invalid_identity", message: "invalid terminal control identity" });

export function createTerminalControlServer(server: HttpServer, deps: TerminalControlServerDeps): TerminalControlServer {
  const lease = createTerminalControlLease(deps.leaseDeps ?? defaultLeaseDeps());
  const io = createSocketServer(server, deps);
  const identifiedConnections = new Set<string>();
  const context = { io, lease, identifiedConnections };
  lease.onChange(() => emitStateToIdentified(context));
  io.on("connection", (socket) => mountControlSocket(socket.id, context));

  return {
    isOwnerInstance(instanceId) {
      return lease.isOwnerInstance(instanceId);
    },

    async close() {
      lease.dispose();
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
    },
  };
}

interface TerminalControlSocketContext {
  io: IOServer;
  lease: TerminalControlLease;
  identifiedConnections: Set<string>;
}

function createSocketServer(server: HttpServer, deps: TerminalControlServerDeps): IOServer {
  return new IOServer(server, {
    path: TERMINAL_CONTROL_SOCKET_PATH,
    transports: ["websocket"],
    allowRequest: (req, cb) => cb(null, deps.isAllowedOrigin(req.headers.origin, req.socket?.remoteAddress)),
    cors: {
      origin: (origin, cb) => cb(null, deps.isAllowedOrigin(origin, undefined)),
      credentials: true,
    },
  });
}

function mountControlSocket(connectionId: string, context: TerminalControlSocketContext): void {
  const socket = context.io.sockets.sockets.get(connectionId);
  if (!socket) return;
  socket.on(TERMINAL_CONTROL_IDENTIFY_EVENT, (payload: unknown) => identify(connectionId, payload, context));
  socket.on(TERMINAL_CONTROL_ACQUIRE_EVENT, () => acquire(connectionId, context));
  socket.on(TERMINAL_CONTROL_RELEASE_EVENT, () => release(connectionId, context));
  socket.on("disconnect", () => {
    context.identifiedConnections.delete(connectionId);
    context.lease.disconnect(connectionId);
  });
}

function identify(connectionId: string, payload: unknown, context: TerminalControlSocketContext): void {
  const identity = normalizeTerminalControlIdentity(payload);
  if (!identity) {
    emitError(connectionId, invalidIdentityError(), context);
    return;
  }
  const result = context.lease.identify(connectionId, identity);
  if (!result.ok) {
    emitError(connectionId, result.error, context);
    return;
  }
  context.identifiedConnections.add(connectionId);
  emitState(connectionId, context.lease.stateFor(connectionId), context);
}

function acquire(connectionId: string, context: TerminalControlSocketContext): void {
  if (!context.identifiedConnections.has(connectionId)) {
    emitError(connectionId, notIdentifiedError(), context);
    return;
  }
  const result = context.lease.acquire(connectionId);
  if (!result.ok) emitError(connectionId, result.error, context);
}

function release(connectionId: string, context: TerminalControlSocketContext): void {
  if (!context.identifiedConnections.has(connectionId)) {
    emitError(connectionId, notIdentifiedError(), context);
    return;
  }
  const result = context.lease.release(connectionId);
  if (!result.ok) emitError(connectionId, result.error, context);
}

function emitStateToIdentified(context: TerminalControlSocketContext): void {
  for (const connectionId of context.identifiedConnections) emitState(connectionId, context.lease.stateFor(connectionId), context);
}

function emitState(connectionId: string, state: TerminalControlState, context: TerminalControlSocketContext): void {
  context.io.to(connectionId).emit(TERMINAL_CONTROL_STATE_EVENT, state);
}

function emitError(connectionId: string, error: TerminalControlError, context: TerminalControlSocketContext): void {
  context.io.to(connectionId).emit(TERMINAL_CONTROL_ERROR_EVENT, error);
}
