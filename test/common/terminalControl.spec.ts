// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  TERMINAL_CONTROL_DEFAULT_LABEL,
  TERMINAL_CONTROL_LABEL_MAX_LENGTH,
  isTerminalControlState,
  normalizeTerminalControlIdentity,
} from "../../common/terminalControl.js";

const CLIENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const INSTANCE_ID = "123e4567-e89b-12d3-a456-426614174001";

describe("terminal control protocol", () => {
  it("accepts a valid identity", () => {
    expect(normalizeTerminalControlIdentity({ clientId: CLIENT_ID, instanceId: INSTANCE_ID, label: "Laptop" })).toEqual({
      clientId: CLIENT_ID,
      instanceId: INSTANCE_ID,
      label: "Laptop",
    });
  });

  it("rejects an invalid clientId", () => {
    expect(normalizeTerminalControlIdentity({ clientId: "nope", instanceId: INSTANCE_ID, label: "Laptop" })).toBeNull();
  });

  it("rejects an invalid instanceId", () => {
    expect(normalizeTerminalControlIdentity({ clientId: CLIENT_ID, instanceId: "nope", label: "Laptop" })).toBeNull();
  });

  it("trims labels", () => {
    expect(normalizeTerminalControlIdentity({ clientId: CLIENT_ID, instanceId: INSTANCE_ID, label: "  Laptop  " })?.label).toBe("Laptop");
  });

  it("caps labels at the maximum length", () => {
    const label = "a".repeat(TERMINAL_CONTROL_LABEL_MAX_LENGTH + 10);
    expect(normalizeTerminalControlIdentity({ clientId: CLIENT_ID, instanceId: INSTANCE_ID, label })?.label).toHaveLength(TERMINAL_CONTROL_LABEL_MAX_LENGTH);
  });

  it("falls back for empty labels", () => {
    expect(normalizeTerminalControlIdentity({ clientId: CLIENT_ID, instanceId: INSTANCE_ID, label: "   " })?.label).toBe(TERMINAL_CONTROL_DEFAULT_LABEL);
  });

  it("removes control characters from labels", () => {
    expect(normalizeTerminalControlIdentity({ clientId: CLIENT_ID, instanceId: INSTANCE_ID, label: "Lap\u0000top\u001b" })?.label).toBe("Laptop");
  });

  it("guards terminal control state received by a client", () => {
    expect(isTerminalControlState({ revision: 1, serverTime: 2, owner: null, isOwner: false })).toBe(true);
    expect(isTerminalControlState({ revision: 1, serverTime: 2, owner: { label: "Laptop", connected: true, leaseExpiresAt: null }, isOwner: true })).toBe(true);
    expect(isTerminalControlState({ revision: 1, serverTime: 2, owner: { label: "Laptop", connected: "yes", leaseExpiresAt: null }, isOwner: true })).toBe(
      false,
    );
    expect(isTerminalControlState({ revision: 1, serverTime: 2, owner: null, isOwner: "no" })).toBe(false);
  });

  it("rejects negative revisions", () => {
    expect(isTerminalControlState({ revision: -1, serverTime: 2, owner: null, isOwner: false })).toBe(false);
  });

  it("rejects fractional revisions", () => {
    expect(isTerminalControlState({ revision: 1.5, serverTime: 2, owner: null, isOwner: false })).toBe(false);
  });

  it("rejects owner lease contradictions", () => {
    expect(isTerminalControlState({ revision: 1, serverTime: 2, owner: { label: "Laptop", connected: true, leaseExpiresAt: 3 }, isOwner: false })).toBe(false);
    expect(isTerminalControlState({ revision: 1, serverTime: 2, owner: { label: "Laptop", connected: false, leaseExpiresAt: null }, isOwner: false })).toBe(
      false,
    );
  });

  it("accepts a connected owner state", () => {
    expect(isTerminalControlState({ revision: 1, serverTime: 2, owner: { label: "Laptop", connected: true, leaseExpiresAt: null }, isOwner: false })).toBe(
      true,
    );
  });

  it("accepts a reserved owner state", () => {
    expect(isTerminalControlState({ revision: 1, serverTime: 2, owner: { label: "Laptop", connected: false, leaseExpiresAt: 12_000 }, isOwner: false })).toBe(
      true,
    );
  });
});
