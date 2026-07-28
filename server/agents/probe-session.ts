// The session ids the rate-limit probe uses for its own throwaway Claude sessions (#1010).
//
// Recognisable by SHAPE rather than by a list this process keeps: the transcripts claude writes
// outlive the server that asked for them, so a remembered set stops recognising its own sessions
// the moment the process restarts and they surface in /api/sessions again (Codex review on #1019).
// A fixed prefix survives that, needs nothing persisted, and cannot drift out of sync with the
// files on disk.
//
// Still a syntactically valid v4-shaped UUID, because `--session-id` and SESSION_ID_RE both
// require one. Only the leading 12 hex digits are fixed; a real random UUID colliding with them is
// a 1-in-2^48 event, and the cost if it ever happened is one chat hidden from a listing.

import { randomBytes } from "node:crypto";

export const PROBE_SESSION_PREFIX = "f0f0f0f0-1a7e-";

/** A fresh id for one probe session. */
export function newProbeSessionId(): string {
  const rest = randomBytes(8).toString("hex"); // 16 hex digits: 4 + 12
  return `${PROBE_SESSION_PREFIX}4${rest.slice(0, 3)}-8${rest.slice(3, 6)}-${rest.slice(4, 16)}`;
}

/** Whether an id belongs to a probe — used to keep those sessions out of the listings. */
export function isProbeSessionId(id: string): boolean {
  return id.startsWith(PROBE_SESSION_PREFIX);
}
