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

// The WHOLE id, not just its opening. A caller builds a file path out of this
// (`<sessions-dir>/<id>.jsonl`), so "starts with the prefix" would accept
// `f0f0f0f0-1a7e-../../…` and resolve outside the directory — and the guard that reads as
// protection would be granting it (Codex review on #1030). Anchored and hex-only, so no separator
// or dot segment can survive.
const PROBE_SESSION_ID_RE = /^f0f0f0f0-1a7e-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh id for one probe session. */
export function newProbeSessionId(): string {
  const rest = randomBytes(8).toString("hex"); // 16 hex digits: 4 + 12
  return `${PROBE_SESSION_PREFIX}4${rest.slice(0, 3)}-8${rest.slice(3, 6)}-${rest.slice(4, 16)}`;
}

/** Whether an id belongs to a probe — used to keep those sessions out of the listings, and to
 *  decide whether a transcript is ours to delete. */
export function isProbeSessionId(id: string): boolean {
  return PROBE_SESSION_ID_RE.test(id);
}
