// A short-lived ordering barrier between a WebSocket launch that has announced its id and the
// HTTP Delete route. It owns no membership or lifecycle fact: Core remains authoritative, and an
// entry exists only until the synchronous Core create/reattach attempt has completed.
interface PendingLaunch {
  count: number;
  settled: Promise<void>;
  resolve: () => void;
}

const pendingLaunches = new Map<string, PendingLaunch>();

export function beginPendingTerminalLaunch(id: string): void {
  const current = pendingLaunches.get(id);
  if (current) {
    current.count++;
    return;
  }
  let resolve!: () => void;
  const settled = new Promise<void>((done) => {
    resolve = done;
  });
  pendingLaunches.set(id, { count: 1, settled, resolve });
}

export function finishPendingTerminalLaunch(id: string): void {
  const current = pendingLaunches.get(id);
  if (!current) return;
  current.count--;
  if (current.count > 0) return;
  pendingLaunches.delete(id);
  current.resolve();
}

export async function waitForPendingTerminalLaunch(id: string): Promise<void> {
  await pendingLaunches.get(id)?.settled;
}
