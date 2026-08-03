import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TERMINAL_CONTROL_ACQUIRE_EVENT,
  TERMINAL_CONTROL_ERROR_EVENT,
  TERMINAL_CONTROL_IDENTIFY_EVENT,
  TERMINAL_CONTROL_RELEASE_EVENT,
  TERMINAL_CONTROL_STATE_EVENT,
  type TerminalControlIdentity,
  type TerminalControlState,
} from "../../../common/terminalControl.js";
import type { TerminalControlIdentityStore } from "../../../src/composables/terminalControlIdentity.js";

const CLIENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const INSTANCE_ID = "123e4567-e89b-42d3-a456-426614174001";

type SocketHandler = (payload?: unknown) => void;

class FakeSocket {
  connected = false;
  readonly emitted: Array<{ event: string; payload: unknown }> = [];
  private readonly handlers = new Map<string, SocketHandler[]>();

  on(event: string, handler: SocketHandler): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }

  emit(event: string, payload?: unknown): void {
    this.emitted.push({ event, payload });
  }

  trigger(event: string, payload?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

class FakeIdentity implements TerminalControlIdentityStore {
  readonly clientId = CLIENT_ID;
  readonly instanceId = INSTANCE_ID;
  private currentLabel = "Development PC";
  readonly savedLabels: string[] = [];

  label(): string {
    return this.currentLabel;
  }

  setLabel(label: string): string {
    this.currentLabel = label;
    this.savedLabels.push(label);
    return this.currentLabel;
  }

  identity(): TerminalControlIdentity {
    return { clientId: this.clientId, instanceId: this.instanceId, label: this.currentLabel };
  }
}

const ownerState = (revision: number): TerminalControlState => ({
  revision,
  serverTime: revision * 100,
  owner: { label: "Development PC", connected: true, leaseExpiresAt: null },
  isOwner: true,
});

async function createClient() {
  const socket = new FakeSocket();
  const identity = new FakeIdentity();
  const factory = vi.fn(() => socket);
  const { createTerminalControlClient } = await import("../../../src/composables/useTerminalControl.js");
  const client = createTerminalControlClient({ identity, socketFactory: factory });
  return { client, socket, identity, factory };
}

describe("useTerminalControl", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("socket.io-client");
    vi.restoreAllMocks();
  });

  it("shares one socket connection across the page singleton", async () => {
    const sockets: FakeSocket[] = [];
    vi.doMock("socket.io-client", () => ({
      io: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    }));
    const { useTerminalControl } = await import("../../../src/composables/useTerminalControl.js");
    const first = useTerminalControl();
    const second = useTerminalControl();
    expect(second).toBe(first);
    expect(sockets).toHaveLength(1);
  });

  it("sends identify on connect", async () => {
    const { socket } = await createClient();
    socket.connected = true;
    socket.trigger("connect");
    expect(socket.emitted).toContainEqual({
      event: TERMINAL_CONTROL_IDENTIFY_EVENT,
      payload: { clientId: CLIENT_ID, instanceId: INSTANCE_ID, label: "Development PC" },
    });
  });

  it("sends identify with the same clientId and instanceId after reconnect", async () => {
    const { socket } = await createClient();
    socket.connected = true;
    socket.trigger("connect");
    socket.connected = false;
    socket.trigger("disconnect");
    socket.connected = true;
    socket.trigger("connect");
    const identifies = socket.emitted.filter((entry) => entry.event === TERMINAL_CONTROL_IDENTIFY_EVENT);
    expect(identifies).toHaveLength(2);
    expect(identifies[1]?.payload).toEqual(identifies[0]?.payload);
  });

  it("stores a valid control state", async () => {
    const { client, socket } = await createClient();
    socket.trigger(TERMINAL_CONTROL_STATE_EVENT, ownerState(1));
    await nextTick();
    expect(client.state.value?.revision).toBe(1);
  });

  it("ignores invalid control state payloads", async () => {
    const { client, socket } = await createClient();
    socket.trigger(TERMINAL_CONTROL_STATE_EVENT, { revision: -1, serverTime: 2, owner: null, isOwner: true });
    await nextTick();
    expect(client.state.value).toBeNull();
  });

  it("ignores older revisions", async () => {
    const { client, socket } = await createClient();
    socket.trigger(TERMINAL_CONTROL_STATE_EVENT, ownerState(2));
    socket.trigger(TERMINAL_CONTROL_STATE_EVENT, { ...ownerState(1), isOwner: false });
    await nextTick();
    expect(client.state.value?.revision).toBe(2);
    expect(client.state.value?.isOwner).toBe(true);
  });

  it("validates and stores control errors", async () => {
    const { client, socket } = await createClient();
    socket.trigger(TERMINAL_CONTROL_ERROR_EVENT, { code: "bad_identity", message: "Bad identity" });
    socket.trigger(TERMINAL_CONTROL_ERROR_EVENT, { code: "bad_identity" });
    await nextTick();
    expect(client.error.value).toEqual({ code: "bad_identity", message: "Bad identity" });
  });

  it("does not treat stale owner state as effective while disconnected", async () => {
    const { client, socket } = await createClient();
    socket.connected = true;
    socket.trigger("connect");
    socket.trigger(TERMINAL_CONTROL_STATE_EVENT, ownerState(1));
    await nextTick();
    expect(client.isOwner.value).toBe(true);
    socket.connected = false;
    socket.trigger("disconnect");
    await nextTick();
    expect(client.isOwner.value).toBe(false);
    expect(client.state.value).toBeNull();
  });

  it("sends acquire when connected with current state", async () => {
    const { client, socket } = await createClient();
    socket.connected = true;
    socket.trigger("connect");
    socket.trigger(TERMINAL_CONTROL_STATE_EVENT, { revision: 1, serverTime: 2, owner: null, isOwner: false });
    client.acquire();
    expect(socket.emitted).toContainEqual({ event: TERMINAL_CONTROL_ACQUIRE_EVENT, payload: undefined });
  });

  it("sends release only for the effective owner", async () => {
    const { client, socket } = await createClient();
    socket.connected = true;
    socket.trigger("connect");
    socket.trigger(TERMINAL_CONTROL_STATE_EVENT, ownerState(1));
    client.release();
    expect(socket.emitted).toContainEqual({ event: TERMINAL_CONTROL_RELEASE_EVENT, payload: undefined });
  });

  it("does not send acquire or release while disconnected", async () => {
    const { client, socket } = await createClient();
    client.acquire();
    client.release();
    expect(socket.emitted.some((entry) => entry.event === TERMINAL_CONTROL_ACQUIRE_EVENT || entry.event === TERMINAL_CONTROL_RELEASE_EVENT)).toBe(false);
  });

  it("normalizes and saves labels, then re-identifies without creating a new socket", async () => {
    const { client, socket, identity, factory } = await createClient();
    socket.connected = true;
    socket.trigger("connect");
    socket.emitted.length = 0;
    expect(client.setLabel("  Living room tablet  ")).toBe("Living room tablet");
    expect(identity.savedLabels).toEqual(["Living room tablet"]);
    expect(client.label.value).toBe("Living room tablet");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(socket.emitted).toEqual([
      { event: TERMINAL_CONTROL_IDENTIFY_EVENT, payload: { clientId: CLIENT_ID, instanceId: INSTANCE_ID, label: "Living room tablet" } },
    ]);
  });
});
