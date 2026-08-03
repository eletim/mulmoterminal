import {
  TERMINAL_CONTROL_DISCONNECT_GRACE_MS,
  type TerminalControlError,
  type TerminalControlIdentity,
  type TerminalControlState,
} from "../../common/terminalControl.js";

export type TimerHandle = ReturnType<typeof setTimeout>;
export type TerminalControlLeaseListener = () => void;

export interface TerminalControlLeaseDeps {
  now: () => number;
  setTimer: (callback: () => void, ms: number) => TimerHandle;
  clearTimer: (handle: TimerHandle) => void;
  disconnectGraceMs?: number;
}

interface OwnerRecord extends TerminalControlIdentity {
  connectionId: string;
  connected: boolean;
  leaseExpiresAt: number | null;
}

export type TerminalControlLeaseResult = { ok: true; changed: boolean } | { ok: false; error: TerminalControlError };

export interface TerminalControlLease {
  identify(connectionId: string, identity: TerminalControlIdentity): TerminalControlLeaseResult;
  acquire(connectionId: string): TerminalControlLeaseResult;
  release(connectionId: string): TerminalControlLeaseResult;
  disconnect(connectionId: string): void;
  stateFor(connectionId: string): TerminalControlState;
  isOwnerInstance(instanceId: string): boolean;
  onChange(listener: TerminalControlLeaseListener): () => void;
  dispose(): void;
}

class TerminalControlLeaseStore implements TerminalControlLease {
  private readonly disconnectGraceMs: number;
  private readonly identities = new Map<string, TerminalControlIdentity>();
  private readonly listeners = new Set<TerminalControlLeaseListener>();
  private owner: OwnerRecord | null = null;
  private revision = 0;
  private leaseTimer: TimerHandle | null = null;

  constructor(private readonly deps: TerminalControlLeaseDeps) {
    this.disconnectGraceMs = deps.disconnectGraceMs ?? TERMINAL_CONTROL_DISCONNECT_GRACE_MS;
  }

  identify(connectionId: string, identity: TerminalControlIdentity): TerminalControlLeaseResult {
    const previous = this.identities.get(connectionId);
    if (previous) return this.reidentify(connectionId, previous, identity);
    this.identities.set(connectionId, identity);
    if (this.owner === null) return { ok: true, changed: this.setOwner(connectionId, identity) };
    if (this.canRestoreReservedOwner(identity)) return { ok: true, changed: this.setOwner(connectionId, identity) };
    return { ok: true, changed: false };
  }

  acquire(connectionId: string): TerminalControlLeaseResult {
    const identity = this.identities.get(connectionId);
    if (!identity) return error("not_identified", "identify before acquiring control");
    return { ok: true, changed: this.setOwner(connectionId, identity) };
  }

  release(connectionId: string): TerminalControlLeaseResult {
    if (!this.owner || !this.owner.connected || this.owner.connectionId !== connectionId) {
      return error("not_owner", "only the current owner can release control");
    }
    this.clearLeaseTimer();
    this.owner = null;
    this.emitChange();
    return { ok: true, changed: true };
  }

  disconnect(connectionId: string): void {
    this.identities.delete(connectionId);
    if (!this.owner || !this.owner.connected || this.owner.connectionId !== connectionId) return;
    const leaseExpiresAt = this.deps.now() + this.disconnectGraceMs;
    this.owner = { ...this.owner, connected: false, leaseExpiresAt };
    this.startLeaseTimer(leaseExpiresAt);
    this.emitChange();
  }

  stateFor(connectionId: string): TerminalControlState {
    return {
      revision: this.revision,
      serverTime: this.deps.now(),
      owner: this.owner ? { label: this.owner.label, connected: this.owner.connected, leaseExpiresAt: this.owner.leaseExpiresAt } : null,
      isOwner: !!this.owner && this.owner.connected && this.owner.connectionId === connectionId,
    };
  }

  isOwnerInstance(instanceId: string): boolean {
    return !!this.owner && this.owner.connected && this.owner.instanceId === instanceId;
  }

  onChange(listener: TerminalControlLeaseListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.clearLeaseTimer();
    this.listeners.clear();
  }

  private reidentify(connectionId: string, previous: TerminalControlIdentity, identity: TerminalControlIdentity): TerminalControlLeaseResult {
    if (previous.clientId !== identity.clientId || previous.instanceId !== identity.instanceId) {
      return error("identity_changed", "connection identity cannot change");
    }
    this.identities.set(connectionId, identity);
    if (this.owner?.connectionId === connectionId && this.owner.connected && this.owner.label !== identity.label) {
      this.owner = { ...this.owner, label: identity.label };
      this.emitChange();
      return { ok: true, changed: true };
    }
    return { ok: true, changed: false };
  }

  private canRestoreReservedOwner(identity: TerminalControlIdentity): boolean {
    return (
      !!this.owner &&
      !this.owner.connected &&
      this.owner.clientId === identity.clientId &&
      this.owner.leaseExpiresAt !== null &&
      this.deps.now() <= this.owner.leaseExpiresAt
    );
  }

  private setOwner(connectionId: string, identity: TerminalControlIdentity): boolean {
    const changed =
      this.owner === null ||
      !this.owner.connected ||
      this.owner.connectionId !== connectionId ||
      this.owner.clientId !== identity.clientId ||
      this.owner.instanceId !== identity.instanceId ||
      this.owner.label !== identity.label ||
      this.owner.leaseExpiresAt !== null;
    this.clearLeaseTimer();
    this.owner = { ...identity, connectionId, connected: true, leaseExpiresAt: null };
    if (changed) this.emitChange();
    return changed;
  }

  private startLeaseTimer(leaseExpiresAt: number): void {
    this.clearLeaseTimer();
    const delay = Math.max(0, leaseExpiresAt - this.deps.now());
    const handle = this.deps.setTimer(() => this.expireLease(leaseExpiresAt), delay);
    handle.unref?.();
    this.leaseTimer = handle;
  }

  private expireLease(leaseExpiresAt: number): void {
    this.leaseTimer = null;
    if (!this.owner || this.owner.connected || this.owner.leaseExpiresAt !== leaseExpiresAt) return;
    this.owner = null;
    this.emitChange();
  }

  private clearLeaseTimer(): void {
    if (this.leaseTimer === null) return;
    this.deps.clearTimer(this.leaseTimer);
    this.leaseTimer = null;
  }

  private emitChange(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

function error(code: string, message: string): TerminalControlLeaseResult {
  return { ok: false, error: { code, message } };
}

export function createTerminalControlLease(deps: TerminalControlLeaseDeps): TerminalControlLease {
  return new TerminalControlLeaseStore(deps);
}
