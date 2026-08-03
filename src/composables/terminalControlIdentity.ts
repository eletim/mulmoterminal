import {
  TERMINAL_CONTROL_DEFAULT_LABEL,
  isTerminalControlUuid,
  normalizeTerminalControlLabel,
  type TerminalControlIdentity,
} from "../../common/terminalControl";

export const TERMINAL_CONTROL_CLIENT_ID_STORAGE_KEY = "mulmoterminal_terminal_control_client_id";
export const TERMINAL_CONTROL_LABEL_STORAGE_KEY = "mulmoterminal_terminal_control_label";

export interface TerminalControlIdentityStore {
  readonly clientId: string;
  readonly instanceId: string;
  label(): string;
  setLabel(label: string): string;
  identity(): TerminalControlIdentity;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface RandomValuesSource {
  getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
}

export interface TerminalControlIdentityDeps {
  sessionStorage?: StorageLike | null;
  localStorage?: StorageLike | null;
  userAgent?: string;
  randomValues?: RandomValuesSource | null;
}

let fallbackCounter = 0;

export function createTerminalControlIdentityStore(deps: TerminalControlIdentityDeps = browserIdentityDeps()): TerminalControlIdentityStore {
  let memoryClientId = "";
  let memoryLabel = "";
  const clientId = storedClientId(deps, () => {
    memoryClientId = generateTerminalControlUuid(deps.randomValues);
    return memoryClientId;
  });
  const instanceId = generateTerminalControlUuid(deps.randomValues);

  const store: TerminalControlIdentityStore = {
    clientId,
    instanceId,
    label() {
      if (memoryLabel) return memoryLabel;
      const stored = readStorage(deps.localStorage ?? null, TERMINAL_CONTROL_LABEL_STORAGE_KEY);
      memoryLabel = normalizeTerminalControlLabel(stored ?? defaultTerminalControlLabel(deps.userAgent ?? ""));
      return memoryLabel;
    },
    setLabel(label) {
      memoryLabel = normalizeTerminalControlLabel(label);
      writeStorage(deps.localStorage ?? null, TERMINAL_CONTROL_LABEL_STORAGE_KEY, memoryLabel);
      return memoryLabel;
    },
    identity() {
      return { clientId, instanceId, label: store.label() };
    },
  };

  return store;
}

export function generateTerminalControlUuid(randomValues: RandomValuesSource | null | undefined = browserRandomValues()): string {
  const bytes = randomBytes(randomValues);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

export function defaultTerminalControlLabel(userAgent: string): string {
  const browser = browserName(userAgent);
  const os = osName(userAgent);
  return normalizeTerminalControlLabel(browser && os ? `${browser} on ${os}` : TERMINAL_CONTROL_DEFAULT_LABEL);
}

function storedClientId(deps: TerminalControlIdentityDeps, fresh: () => string): string {
  const storage = deps.sessionStorage ?? null;
  const stored = readStorage(storage, TERMINAL_CONTROL_CLIENT_ID_STORAGE_KEY);
  if (stored && isTerminalControlUuid(stored)) return stored;
  const next = fresh();
  writeStorage(storage, TERMINAL_CONTROL_CLIENT_ID_STORAGE_KEY, next);
  return next;
}

function randomBytes(randomValues: RandomValuesSource | null | undefined): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  try {
    if (randomValues) return randomValues.getRandomValues(bytes);
  } catch {
    // fall through to non-cryptographic fallback
  }
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = fallbackByte(i);
  return bytes;
}

function fallbackByte(index: number): number {
  fallbackCounter = (fallbackCounter + 1) & 0xffff;
  // eslint-disable-next-line sonarjs/pseudo-random -- This fallback ID is not an authentication secret.
  const mixed = Date.now() + Math.floor(Math.random() * 0xffffffff) + fallbackCounter * 31 + index * 17;
  return mixed & 0xff;
}

function browserName(userAgent: string): string | null {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(userAgent) && !/Edg\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent) && !/Chrome\/|CriOS\//.test(userAgent)) return "Safari";
  return null;
}

function osName(userAgent: string): string | null {
  if (/Android/.test(userAgent)) return "Android";
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Windows NT/.test(userAgent)) return "Windows";
  if (/Mac OS X|Macintosh/.test(userAgent)) return "macOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return null;
}

function readStorage(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(storage: StorageLike | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // best effort only
  }
}

function browserIdentityDeps(): TerminalControlIdentityDeps {
  return {
    sessionStorage: browserSessionStorage(),
    localStorage: browserLocalStorage(),
    userAgent: globalThis.navigator?.userAgent ?? "",
    randomValues: browserRandomValues(),
  };
}

function browserSessionStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function browserLocalStorage(): StorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function browserRandomValues(): RandomValuesSource | null {
  const crypto = globalThis.crypto;
  if (!crypto || !("getRandomValues" in crypto)) return null;
  return {
    getRandomValues(array) {
      crypto.getRandomValues(array);
      return array;
    },
  };
}

export const terminalControlIdentity = createTerminalControlIdentityStore();
