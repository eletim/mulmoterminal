// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isTerminalControlUuid } from "../../../common/terminalControl.js";
import {
  TERMINAL_CONTROL_CLIENT_ID_STORAGE_KEY,
  TERMINAL_CONTROL_LABEL_STORAGE_KEY,
  createTerminalControlIdentityStore,
  defaultTerminalControlLabel,
  generateTerminalControlUuid,
} from "../../../src/composables/terminalControlIdentity.js";

const VALID_CLIENT_ID = "123e4567-e89b-42d3-a456-426614174000";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingGetStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error("get failed");
  }
}

class ThrowingSetStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error("set failed");
  }
}

function randomSource(seed = 1) {
  let call = seed;
  return {
    getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
      for (let i = 0; i < array.length; i += 1) array[i] = (call + i * 17) & 0xff;
      call += 23;
      return array;
    },
  };
}

describe("terminal control identity", () => {
  it("generates UUIDs accepted by the terminal control protocol", () => {
    expect(isTerminalControlUuid(generateTerminalControlUuid(randomSource()))).toBe(true);
  });

  it("sets UUID v4 version and variant bits", () => {
    const uuid = generateTerminalControlUuid(randomSource());
    expect(uuid[14]).toBe("4");
    expect(["8", "9", "a", "b"]).toContain(uuid[19]);
  });

  it("reuses a valid stored clientId", () => {
    const sessionStorage = new MemoryStorage();
    sessionStorage.setItem(TERMINAL_CONTROL_CLIENT_ID_STORAGE_KEY, VALID_CLIENT_ID);
    const identity = createTerminalControlIdentityStore({ sessionStorage, randomValues: randomSource() });
    expect(identity.clientId).toBe(VALID_CLIENT_ID);
  });

  it("replaces a broken stored clientId", () => {
    const sessionStorage = new MemoryStorage();
    sessionStorage.setItem(TERMINAL_CONTROL_CLIENT_ID_STORAGE_KEY, "broken");
    const identity = createTerminalControlIdentityStore({ sessionStorage, randomValues: randomSource() });
    expect(identity.clientId).not.toBe("broken");
    expect(isTerminalControlUuid(identity.clientId)).toBe(true);
    expect(sessionStorage.getItem(TERMINAL_CONTROL_CLIENT_ID_STORAGE_KEY)).toBe(identity.clientId);
  });

  it("continues when sessionStorage.getItem throws", () => {
    const identity = createTerminalControlIdentityStore({ sessionStorage: new ThrowingGetStorage(), randomValues: randomSource() });
    expect(isTerminalControlUuid(identity.clientId)).toBe(true);
  });

  it("continues when sessionStorage.setItem throws", () => {
    const identity = createTerminalControlIdentityStore({ sessionStorage: new ThrowingSetStorage(), randomValues: randomSource() });
    expect(isTerminalControlUuid(identity.clientId)).toBe(true);
  });

  it("does not store instanceId", () => {
    const sessionStorage = new MemoryStorage();
    const identity = createTerminalControlIdentityStore({ sessionStorage, randomValues: randomSource() });
    expect(identity.instanceId).not.toBe("");
    expect(sessionStorage.getItem(TERMINAL_CONTROL_CLIENT_ID_STORAGE_KEY)).toBe(identity.clientId);
    expect(sessionStorage.getItem(identity.instanceId)).toBeNull();
  });

  it("keeps one instanceId for a page identity factory", () => {
    const identity = createTerminalControlIdentityStore({ randomValues: randomSource() });
    expect(identity.instanceId).toBe(identity.identity().instanceId);
  });

  it("generates a new instanceId for a new identity factory", () => {
    const source = randomSource();
    const first = createTerminalControlIdentityStore({ randomValues: source });
    const second = createTerminalControlIdentityStore({ randomValues: source });
    expect(second.instanceId).not.toBe(first.instanceId);
  });

  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36", "Chrome on Windows"],
    ["Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36", "Chrome on Android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", "Safari on iPhone"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15", "Safari on macOS"],
    ["Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/127.0", "Firefox on Linux"],
  ])("builds a default label for %s", (userAgent, label) => {
    expect(defaultTerminalControlLabel(userAgent)).toBe(label);
  });

  it("detects Edge before Chrome", () => {
    expect(defaultTerminalControlLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0")).toBe(
      "Edge on Windows",
    );
  });

  it("falls back for empty labels", () => {
    const identity = createTerminalControlIdentityStore({ randomValues: randomSource() });
    expect(identity.setLabel("   ")).toBe("Unknown device");
  });

  it("keeps label changes in memory when localStorage is unavailable", () => {
    const identity = createTerminalControlIdentityStore({ localStorage: new ThrowingSetStorage(), randomValues: randomSource() });
    expect(identity.setLabel("Development PC")).toBe("Development PC");
    expect(identity.label()).toBe("Development PC");
  });

  it("loads a stored label when available", () => {
    const localStorage = new MemoryStorage();
    localStorage.setItem(TERMINAL_CONTROL_LABEL_STORAGE_KEY, "Xiaomi phone");
    const identity = createTerminalControlIdentityStore({ localStorage, randomValues: randomSource() });
    expect(identity.label()).toBe("Xiaomi phone");
  });
});
