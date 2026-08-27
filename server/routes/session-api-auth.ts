import { isLoopbackAddress } from "../infra/loopback.js";

export function sessionApiBearerToken(raw: string | string[] | undefined): string | null {
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== "string") return null;
  const trimmed = header.trim();
  const separator = trimmed.indexOf(" ");
  if (separator < 0 || trimmed.slice(0, separator).toLowerCase() !== "bearer") return null;
  const token = trimmed.slice(separator + 1).trim();
  return token || null;
}

export function localServerToServerAllowed(origin: string | undefined, remoteAddress: string | undefined): boolean {
  if (origin) return false;
  return remoteAddress === undefined || isLoopbackAddress(remoteAddress);
}
