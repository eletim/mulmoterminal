import { computed, ref, type ComputedRef, type Ref } from "vue";
import { io } from "socket.io-client";
import {
  TERMINAL_CONTROL_ACQUIRE_EVENT,
  TERMINAL_CONTROL_ERROR_EVENT,
  TERMINAL_CONTROL_IDENTIFY_EVENT,
  TERMINAL_CONTROL_RELEASE_EVENT,
  TERMINAL_CONTROL_SOCKET_PATH,
  TERMINAL_CONTROL_STATE_EVENT,
  isTerminalControlError,
  isTerminalControlState,
  normalizeTerminalControlLabel,
  type TerminalControlError,
  type TerminalControlIdentity,
  type TerminalControlOwnerView,
  type TerminalControlState,
} from "../../common/terminalControl";
import { terminalControlIdentity, type TerminalControlIdentityStore } from "./terminalControlIdentity";

export type TerminalControlConnectionStatus = "connecting" | "connected" | "disconnected";

interface TerminalControlSocket {
  connected: boolean;
  on(event: string, handler: (payload?: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
}

type TerminalControlSocketFactory = () => TerminalControlSocket;

export interface TerminalControlClient {
  connectionStatus: Ref<TerminalControlConnectionStatus>;
  state: Ref<TerminalControlState | null>;
  isOwner: ComputedRef<boolean>;
  owner: ComputedRef<TerminalControlOwnerView | null>;
  error: Ref<TerminalControlError | null>;
  clientId: string;
  instanceId: string;
  label: Ref<string>;
  ready: ComputedRef<boolean>;
  ownerLabel: ComputedRef<string | null>;
  ownerConnected: ComputedRef<boolean>;
  leaseExpiresAt: ComputedRef<number | null>;
  acquire: () => void;
  release: () => void;
  setLabel: (label: string) => string;
}

interface TerminalControlClientDeps {
  identity: TerminalControlIdentityStore;
  socketFactory: TerminalControlSocketFactory;
}

interface TerminalControlClientRefs {
  connectionStatus: Ref<TerminalControlConnectionStatus>;
  state: Ref<TerminalControlState | null>;
  error: Ref<TerminalControlError | null>;
}

let singleton: TerminalControlClient | null = null;

export function useTerminalControl(): TerminalControlClient {
  if (!singleton) singleton = createTerminalControlClient({ identity: terminalControlIdentity, socketFactory: defaultSocketFactory });
  return singleton;
}

export function createTerminalControlClient({ identity, socketFactory }: TerminalControlClientDeps): TerminalControlClient {
  const connectionStatus = ref<TerminalControlConnectionStatus>("connecting");
  const state = ref<TerminalControlState | null>(null);
  const error = ref<TerminalControlError | null>(null);
  const label = ref(identity.label());
  const socket = socketFactory();

  const isOwner = computed(() => socket.connected && state.value?.isOwner === true);
  const owner = computed(() => state.value?.owner ?? null);
  const ready = computed(() => connectionStatus.value === "connected" && state.value !== null);
  const ownerLabel = computed(() => owner.value?.label ?? null);
  const ownerConnected = computed(() => owner.value?.connected === true);
  const leaseExpiresAt = computed(() => owner.value?.leaseExpiresAt ?? null);

  registerTerminalControlSocketHandlers(socket, identity, { connectionStatus, state, error });

  return {
    connectionStatus,
    state,
    isOwner,
    owner,
    error,
    clientId: identity.clientId,
    instanceId: identity.instanceId,
    label,
    ready,
    ownerLabel,
    ownerConnected,
    leaseExpiresAt,
    acquire() {
      if (!socket.connected || !state.value) return;
      socket.emit(TERMINAL_CONTROL_ACQUIRE_EVENT);
    },
    release() {
      if (!isOwner.value) return;
      socket.emit(TERMINAL_CONTROL_RELEASE_EVENT);
    },
    setLabel(nextLabel) {
      label.value = identity.setLabel(normalizeTerminalControlLabel(nextLabel));
      if (socket.connected) sendIdentify(socket, identity.identity());
      return label.value;
    },
  };
}

function sendIdentify(socket: TerminalControlSocket, identity: TerminalControlIdentity): void {
  socket.emit(TERMINAL_CONTROL_IDENTIFY_EVENT, identity);
}

function registerTerminalControlSocketHandlers(socket: TerminalControlSocket, identity: TerminalControlIdentityStore, refs: TerminalControlClientRefs): void {
  socket.on("connect", () => {
    refs.connectionStatus.value = "connected";
    sendIdentify(socket, identity.identity());
  });
  socket.on("disconnect", () => {
    refs.connectionStatus.value = "disconnected";
    refs.state.value = null;
  });
  socket.on("connect_error", (payload) => {
    refs.connectionStatus.value = "disconnected";
    if (payload instanceof Error) refs.error.value = { code: "connect_error", message: payload.message };
  });
  socket.on(TERMINAL_CONTROL_STATE_EVENT, (payload) => {
    if (!isTerminalControlState(payload)) return;
    if (refs.state.value && payload.revision <= refs.state.value.revision) return;
    refs.state.value = payload;
    refs.error.value = null;
  });
  socket.on(TERMINAL_CONTROL_ERROR_EVENT, (payload) => {
    if (isTerminalControlError(payload)) refs.error.value = payload;
  });
}

function defaultSocketFactory(): TerminalControlSocket {
  return io({ path: TERMINAL_CONTROL_SOCKET_PATH, transports: ["websocket"] });
}
