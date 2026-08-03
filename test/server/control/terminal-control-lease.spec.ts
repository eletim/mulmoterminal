// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { TERMINAL_CONTROL_DISCONNECT_GRACE_MS, type TerminalControlIdentity } from "../../../common/terminalControl.js";
import { createTerminalControlLease } from "../../../server/control/terminal-control-lease.js";

const A_CLIENT = "123e4567-e89b-12d3-a456-426614174000";
const A_INSTANCE = "123e4567-e89b-12d3-a456-426614174001";
const A_INSTANCE_RELOADED = "123e4567-e89b-12d3-a456-426614174002";
const B_CLIENT = "123e4567-e89b-12d3-a456-426614174100";
const B_INSTANCE = "123e4567-e89b-12d3-a456-426614174101";

const identity = (clientId: string, instanceId: string, label: string): TerminalControlIdentity => ({ clientId, instanceId, label });
const a = (label = "A"): TerminalControlIdentity => identity(A_CLIENT, A_INSTANCE, label);
const b = (label = "B"): TerminalControlIdentity => identity(B_CLIENT, B_INSTANCE, label);

function harness() {
  vi.useFakeTimers();
  let now = 1_000;
  const lease = createTerminalControlLease({
    now: () => now,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle),
  });
  return {
    lease,
    advance(ms: number) {
      now += ms;
      vi.advanceTimersByTime(ms);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("terminal control lease", () => {
  it("automatically gives control to the first identified connection", () => {
    const { lease } = harness();

    expect(lease.identify("c1", a())).toEqual({ ok: true, changed: true });
    expect(lease.stateFor("c1")).toMatchObject({ revision: 1, isOwner: true, owner: { label: "A", connected: true, leaseExpiresAt: null } });
    expect(lease.isOwnerInstance(A_INSTANCE)).toBe(true);
  });

  it("leaves the second identified connection as a viewer", () => {
    const { lease } = harness();

    lease.identify("c1", a());
    expect(lease.identify("c2", b())).toEqual({ ok: true, changed: false });
    expect(lease.stateFor("c1").isOwner).toBe(true);
    expect(lease.stateFor("c2").isOwner).toBe(false);
    expect(lease.stateFor("c2").revision).toBe(1);
  });

  it("transfers immediately when a viewer acquires control", () => {
    const { lease } = harness();

    lease.identify("c1", a());
    lease.identify("c2", b());
    expect(lease.acquire("c2")).toEqual({ ok: true, changed: true });

    expect(lease.stateFor("c1").isOwner).toBe(false);
    expect(lease.stateFor("c2")).toMatchObject({ revision: 2, isOwner: true, owner: { label: "B", connected: true } });
    expect(lease.isOwnerInstance(A_INSTANCE)).toBe(false);
    expect(lease.isOwnerInstance(B_INSTANCE)).toBe(true);
  });

  it("allows only the current owner to release control", () => {
    const { lease } = harness();

    lease.identify("c1", a());
    lease.identify("c2", b());
    const failed = lease.release("c2");
    expect(failed.ok).toBe(false);
    expect(lease.stateFor("c1").owner).not.toBeNull();

    expect(lease.release("c1")).toEqual({ ok: true, changed: true });
    expect(lease.stateFor("c1")).toMatchObject({ revision: 2, owner: null, isOwner: false });
  });

  it("does not change owner state when a non-owner disconnects", () => {
    const { lease } = harness();

    lease.identify("c1", a());
    lease.identify("c2", b());
    lease.disconnect("c2");

    expect(lease.stateFor("c1")).toMatchObject({ revision: 1, isOwner: true, owner: { connected: true } });
  });

  it("reserves control for ten seconds when the owner disconnects", () => {
    const { lease } = harness();

    lease.identify("c1", a());
    lease.disconnect("c1");

    expect(lease.stateFor("c1")).toMatchObject({
      revision: 2,
      isOwner: false,
      owner: { label: "A", connected: false, leaseExpiresAt: 1_000 + TERMINAL_CONTROL_DISCONNECT_GRACE_MS },
    });
    expect(lease.isOwnerInstance(A_INSTANCE)).toBe(false);
  });

  it("restores control to the same clientId within the grace period using the new instanceId", () => {
    const { lease, advance } = harness();

    lease.identify("c1", a());
    lease.disconnect("c1");
    advance(5_000);
    lease.identify("c2", identity(A_CLIENT, A_INSTANCE_RELOADED, "A reloaded"));

    expect(lease.stateFor("c2")).toMatchObject({ revision: 3, isOwner: true, owner: { label: "A reloaded", connected: true, leaseExpiresAt: null } });
    expect(lease.isOwnerInstance(A_INSTANCE)).toBe(false);
    expect(lease.isOwnerInstance(A_INSTANCE_RELOADED)).toBe(true);
  });

  it("does not let a different clientId steal a reservation by identifying", () => {
    const { lease } = harness();

    lease.identify("c1", a());
    lease.disconnect("c1");
    lease.identify("c2", b());

    expect(lease.stateFor("c2")).toMatchObject({ revision: 2, isOwner: false, owner: { label: "A", connected: false } });
  });

  it("lets a different clientId explicitly acquire during the reservation", () => {
    const { lease } = harness();

    lease.identify("c1", a());
    lease.disconnect("c1");
    lease.identify("c2", b());
    lease.acquire("c2");

    expect(lease.stateFor("c2")).toMatchObject({ revision: 3, isOwner: true, owner: { label: "B", connected: true, leaseExpiresAt: null } });
  });

  it("clears the owner after the grace period and does not auto-transfer to a viewer", () => {
    const { lease, advance } = harness();

    lease.identify("c1", a());
    lease.identify("c2", b());
    lease.disconnect("c1");
    advance(TERMINAL_CONTROL_DISCONNECT_GRACE_MS);

    expect(lease.stateFor("c2")).toMatchObject({ revision: 3, owner: null, isOwner: false });
  });

  it("does not let an old timer clear a newer owner", () => {
    const { lease, advance } = harness();

    lease.identify("c1", a());
    lease.disconnect("c1");
    lease.identify("c2", b());
    lease.acquire("c2");
    advance(TERMINAL_CONTROL_DISCONNECT_GRACE_MS);

    expect(lease.stateFor("c2")).toMatchObject({ owner: { label: "B", connected: true }, isOwner: true });
  });

  it("clears the active timer on dispose", () => {
    const { lease, advance } = harness();

    lease.identify("c1", a());
    lease.disconnect("c1");
    lease.dispose();
    advance(TERMINAL_CONTROL_DISCONNECT_GRACE_MS);

    expect(lease.stateFor("c1")).toMatchObject({ revision: 2, owner: { label: "A", connected: false } });
  });

  it("does not expose clientId, instanceId, or connectionId in state", () => {
    const { lease } = harness();

    lease.identify("c1", a());
    const owner = lease.stateFor("c2").owner;
    expect(owner).toEqual({ label: "A", connected: true, leaseExpiresAt: null });
    expect(owner && Object.hasOwn(owner, "clientId")).toBe(false);
    expect(owner && Object.hasOwn(owner, "instanceId")).toBe(false);
    expect(owner && Object.hasOwn(owner, "connectionId")).toBe(false);
  });

  it("increments revision only for meaningful owner changes", () => {
    const { lease, advance } = harness();
    let changes = 0;
    lease.onChange(() => {
      changes += 1;
    });

    lease.identify("c1", a());
    lease.identify("c2", b());
    lease.identify("c1", a());
    expect(lease.stateFor("c1").revision).toBe(1);
    expect(changes).toBe(1);

    lease.identify("c1", a("A renamed"));
    expect(lease.stateFor("c1").revision).toBe(2);
    expect(changes).toBe(2);

    lease.disconnect("c2");
    expect(lease.stateFor("c1").revision).toBe(2);

    lease.disconnect("c1");
    expect(lease.stateFor("c2").revision).toBe(3);

    advance(TERMINAL_CONTROL_DISCONNECT_GRACE_MS);
    expect(lease.stateFor("c2").revision).toBe(4);
    expect(changes).toBe(4);
  });

  it("treats repeated identify from the same connection and identity as idempotent", () => {
    const { lease } = harness();

    expect(lease.identify("c1", a())).toEqual({ ok: true, changed: true });
    expect(lease.identify("c1", a())).toEqual({ ok: true, changed: false });
    expect(lease.stateFor("c1").revision).toBe(1);
  });

  it("rejects identity changes on an existing connection", () => {
    const { lease } = harness();

    lease.identify("c1", a());
    const result = lease.identify("c1", identity(B_CLIENT, A_INSTANCE, "B"));

    expect(result.ok).toBe(false);
    expect(lease.stateFor("c1")).toMatchObject({ revision: 1, isOwner: true, owner: { label: "A" } });
  });

  it("rejects acquire before identify", () => {
    const { lease } = harness();

    expect(lease.acquire("c1").ok).toBe(false);
  });
});
