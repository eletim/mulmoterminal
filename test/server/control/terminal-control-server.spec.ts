// @vitest-environment node
import { createServer, type Server as HttpServer } from "node:http";
import { io as connectSocket, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";

import {
  TERMINAL_CONTROL_ACQUIRE_EVENT,
  TERMINAL_CONTROL_ERROR_EVENT,
  TERMINAL_CONTROL_IDENTIFY_EVENT,
  TERMINAL_CONTROL_RELEASE_EVENT,
  TERMINAL_CONTROL_SOCKET_PATH,
  TERMINAL_CONTROL_STATE_EVENT,
  isTerminalControlError,
  isTerminalControlState,
  type TerminalControlIdentity,
  type TerminalControlState,
} from "../../../common/terminalControl.js";
import { createTerminalControlServer, type TerminalControlServer } from "../../../server/control/terminal-control-server.js";
import { createPubSub } from "../../../server/infra/pubsub.js";

const A_CLIENT = "123e4567-e89b-12d3-a456-426614174000";
const A_INSTANCE = "123e4567-e89b-12d3-a456-426614174001";
const B_CLIENT = "123e4567-e89b-12d3-a456-426614174100";
const B_INSTANCE = "123e4567-e89b-12d3-a456-426614174101";

const a: TerminalControlIdentity = { clientId: A_CLIENT, instanceId: A_INSTANCE, label: "A" };
const b: TerminalControlIdentity = { clientId: B_CLIENT, instanceId: B_INSTANCE, label: "B" };

interface StartedServer {
  baseUrl: string;
  httpServer: HttpServer;
  control: TerminalControlServer;
  pubsub: ReturnType<typeof createPubSub> | null;
  close: () => Promise<void>;
}

const sockets: Socket[] = [];
const servers: StartedServer[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  for (const server of servers.splice(0).reverse()) await server.close();
});

describe("terminal control socket server", () => {
  it("sends initial state after identify", async () => {
    const started = await startServer();
    const socket = await controlSocket(started.baseUrl);

    const state = await identify(socket, a);

    expect(state).toMatchObject({ revision: 1, isOwner: true, owner: { label: "A", connected: true, leaseExpiresAt: null } });
    expect(started.control.isOwnerInstance(A_INSTANCE)).toBe(true);
  });

  it("sends per-client isOwner values to two clients", async () => {
    const started = await startServer();
    const first = await controlSocket(started.baseUrl);
    const second = await controlSocket(started.baseUrl);

    const firstState = await identify(first, a);
    const secondState = await identify(second, b);

    expect(firstState.isOwner).toBe(true);
    expect(secondState.isOwner).toBe(false);
  });

  it("updates both clients after acquire", async () => {
    const started = await startServer();
    const first = await controlSocket(started.baseUrl);
    const second = await controlSocket(started.baseUrl);

    await identify(first, a);
    await identify(second, b);
    const firstUpdate = nextState(first);
    const secondUpdate = nextState(second);
    second.emit(TERMINAL_CONTROL_ACQUIRE_EVENT);

    expect(await firstUpdate).toMatchObject({ isOwner: false, owner: { label: "B", connected: true } });
    expect(await secondUpdate).toMatchObject({ isOwner: true, owner: { label: "B", connected: true } });
  });

  it("reports errors for unidentified acquire and invalid identify", async () => {
    const started = await startServer();
    const socket = await controlSocket(started.baseUrl);

    const acquireError = nextError(socket);
    socket.emit(TERMINAL_CONTROL_ACQUIRE_EVENT);
    expect(await acquireError).toMatchObject({ code: "not_identified" });

    const identifyError = nextError(socket);
    socket.emit(TERMINAL_CONTROL_IDENTIFY_EVENT, { clientId: "bad", instanceId: A_INSTANCE, label: "A" });
    expect(await identifyError).toMatchObject({ code: "invalid_identity" });
  });

  it("reports an error when a non-owner releases", async () => {
    const started = await startServer();
    const first = await controlSocket(started.baseUrl);
    const second = await controlSocket(started.baseUrl);

    await identify(first, a);
    await identify(second, b);
    const error = nextError(second);
    second.emit(TERMINAL_CONTROL_RELEASE_EVENT);

    expect(await error).toMatchObject({ code: "not_owner" });
  });

  it("reflects owner disconnect in the lease and published state", async () => {
    const started = await startServer();
    const owner = await controlSocket(started.baseUrl);
    const viewer = await controlSocket(started.baseUrl);

    await identify(owner, a);
    await identify(viewer, b);
    const update = nextState(viewer);
    owner.disconnect();

    expect(await update).toMatchObject({ isOwner: false, owner: { label: "A", connected: false } });
    expect(started.control.isOwnerInstance(A_INSTANCE)).toBe(false);
  });

  it("rejects disallowed origins", async () => {
    const started = await startServer(() => false);
    const socket = trackSocket(connectControl(started.baseUrl));
    const error = await connectError(socket);

    expect(error.message).toBeTruthy();
    expect(socket.connected).toBe(false);
  });

  it("coexists with /ws/pubsub on the same HTTP server", async () => {
    const started = await startServer(() => true, true);
    const control = await controlSocket(started.baseUrl);
    const pubsubSocket = await pubsubSocketAt(started.baseUrl);

    const state = await identify(control, a);
    expect(state.isOwner).toBe(true);

    const data = nextPubsubData(pubsubSocket);
    pubsubSocket.emit("subscribe", "terminal-control-test");
    await waitForSubscriber(started, "terminal-control-test");
    started.pubsub?.publish("terminal-control-test", { ok: true });

    expect(await data).toEqual({ channel: "terminal-control-test", data: { ok: true } });
  });
});

async function startServer(
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean = () => true,
  withPubsub = false,
): Promise<StartedServer> {
  const httpServer = createServer();
  const pubsub = withPubsub ? createPubSub(httpServer, isAllowedOrigin) : null;
  const control = createTerminalControlServer(httpServer, { isAllowedOrigin });
  await listen(httpServer);
  const started = {
    baseUrl: `http://127.0.0.1:${portOf(httpServer)}`,
    httpServer,
    control,
    pubsub,
    async close() {
      await control.close();
      await closeHttpServer(httpServer);
    },
  };
  servers.push(started);
  return started;
}

function connectControl(baseUrl: string): Socket {
  return connectSocket(baseUrl, { path: TERMINAL_CONTROL_SOCKET_PATH, transports: ["websocket"], forceNew: true, reconnection: false });
}

async function controlSocket(baseUrl: string): Promise<Socket> {
  const socket = trackSocket(connectControl(baseUrl));
  await connected(socket);
  return socket;
}

async function pubsubSocketAt(baseUrl: string): Promise<Socket> {
  const socket = trackSocket(connectSocket(baseUrl, { path: "/ws/pubsub", transports: ["websocket"], forceNew: true, reconnection: false }));
  await connected(socket);
  return socket;
}

function trackSocket(socket: Socket): Socket {
  sockets.push(socket);
  return socket;
}

async function identify(socket: Socket, identity: TerminalControlIdentity): Promise<TerminalControlState> {
  return nextStateAfter(socket, () => socket.emit(TERMINAL_CONTROL_IDENTIFY_EVENT, identity));
}

function nextStateAfter(socket: Socket, action: () => void): Promise<TerminalControlState> {
  const state = nextState(socket);
  action();
  return state;
}

function nextState(socket: Socket): Promise<TerminalControlState> {
  return new Promise((resolve, reject) => {
    socket.once(TERMINAL_CONTROL_STATE_EVENT, (payload: unknown) => {
      if (isTerminalControlState(payload)) resolve(payload);
      else reject(new Error("invalid terminal control state"));
    });
  });
}

function nextError(socket: Socket): Promise<{ code: string; message: string }> {
  return new Promise((resolve, reject) => {
    socket.once(TERMINAL_CONTROL_ERROR_EVENT, (payload: unknown) => {
      if (isTerminalControlError(payload)) resolve(payload);
      else reject(new Error("invalid terminal control error"));
    });
  });
}

function nextPubsubData(socket: Socket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once("data", (payload: unknown) => resolve(payload));
  });
}

async function waitForSubscriber(started: StartedServer, channel: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((started.pubsub?.subscriberCount(channel) ?? 0) > 0) return;
    await delay();
  }
  throw new Error("pubsub subscriber did not join");
}

function connected(socket: Socket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (err) => reject(err));
  });
}

function connectError(socket: Socket): Promise<Error> {
  return new Promise((resolve) => {
    socket.once("connect_error", (err) => resolve(err));
  });
}

function listen(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function portOf(server: HttpServer): number {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("HTTP server has no TCP port");
  return address.port;
}

function delay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
