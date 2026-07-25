import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SESSION_KEY,
  healthOrFallback,
  loadStoredSession,
  persistSession,
  reconnectAction,
  type FetchResult,
} from "../../../src/components/remoteHostSession.js";

const okStatus = { connected: true, uid: "u1" };
const okHealth = { state: "online" as const, lastError: null, changedAt: 1 };

describe("reconnectAction", () => {
  it("parks the blob on a successful reconnect (case 1)", () => {
    const res: FetchResult = { ok: true, status: okStatus, session: "blob-v2", health: okHealth };
    expect(reconnectAction(res)).toBe("park");
  });

  it("drops the blob on 401 — expired/invalid (case 2)", () => {
    const res: FetchResult = { ok: false, error: "expired", httpStatus: 401 };
    expect(reconnectAction(res)).toBe("drop");
  });

  it("keeps the blob on a transient 5xx (case 3)", () => {
    const res: FetchResult = { ok: false, error: "backend", httpStatus: 503 };
    expect(reconnectAction(res)).toBe("keep");
  });

  it("keeps the blob on a network failure (httpStatus 0)", () => {
    const res: FetchResult = { ok: false, error: "offline", httpStatus: 0 };
    expect(reconnectAction(res)).toBe("keep");
  });
});

// The health block is what the toolbar renders; a malformed one has to read as "nothing
// reported" rather than paint a state the server never claimed.
describe("healthOrFallback", () => {
  it("keeps a well-formed health as-is", () => {
    const health = { state: "reconnecting", lastError: "listen: unavailable", changedAt: 42 };
    expect(healthOrFallback(health, true)).toEqual(health);
  });

  it("falls back to what `connected` implies when there is no health", () => {
    expect(healthOrFallback(undefined, true).state).toBe("online");
    expect(healthOrFallback(undefined, false).state).toBe("offline");
  });

  it.each([
    ["an unknown state", { state: "flapping", lastError: null, changedAt: 1 }],
    ["a missing timestamp", { state: "online", lastError: null }],
    ["a non-string error", { state: "online", lastError: 500, changedAt: 1 }],
    ["a bare string", "online"],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(healthOrFallback(value, false).state).toBe("offline");
    expect(healthOrFallback(value, false).lastError).toBeNull();
  });
});

describe("persistSession / loadStoredSession", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a blob and removes it on null", () => {
    persistSession("blob-1");
    expect(localStorage.getItem(SESSION_KEY)).toBe("blob-1");
    expect(loadStoredSession()).toBe("blob-1");
    persistSession(null);
    expect(loadStoredSession()).toBeNull();
  });

  it("degrades to no-op when localStorage throws (private mode)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => persistSession("x")).not.toThrow();
    spy.mockRestore();
  });
});
