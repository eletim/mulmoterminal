import { randomUUID } from "node:crypto";

const LAUNCH_TTL_MS = 60_000;
const launches = new Map<string, { sessionId: string | null; updatedAt: number }>();

export function createMobileTerminalLaunchRequest(): string {
  const requestId = randomUUID();
  launches.set(requestId, { sessionId: null, updatedAt: Date.now() });
  return requestId;
}

export function recordMobileTerminalLaunch(requestId: string | null, sessionId: string): void {
  if (!requestId || !launches.has(requestId)) return;
  launches.set(requestId, { sessionId, updatedAt: Date.now() });
}

export function mobileTerminalLaunchSession(requestId: string): string | null | undefined {
  const found = launches.get(requestId);
  if (!found) return undefined;
  if (Date.now() - found.updatedAt > LAUNCH_TTL_MS) {
    launches.delete(requestId);
    return undefined;
  }
  return found.sessionId;
}
