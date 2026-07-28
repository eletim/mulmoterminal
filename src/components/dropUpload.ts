// Sending a dropped file's bytes to the host, for the case dropPaths.ts cannot serve: the
// browser withheld the real path (Chrome always, and every browser when MulmoTerminal is open
// from another machine, where a local path would name nothing on the host anyway).
//
// The path that comes back is absolute and inside the directory this session was granted at
// spawn time, so it inserts and reads exactly like a path the drag had carried itself.
import { DROP_FILENAME_HEADER, MAX_DROP_BYTES, type DropUploadResponse } from "../../common/dropUpload";
import { isRecord } from "../../common/isRecord";

// Generous: this is a real upload of up to MAX_DROP_BYTES, possibly over a phone's connection.
// Matched to the server's own ceiling for network mutations rather than a UI-scale timeout.
const UPLOAD_TIMEOUT_MS = 300_000;

const FALLBACK_MIME = "application/octet-stream";

export type DropUploadResult = { ok: true; path: string } | { ok: false; status: number | null };

export const dropUploadUrl = (sessionId: string): string => `/api/session/${encodeURIComponent(sessionId)}/drop`;

/** The sentence to show when an upload did not happen. Keyed on status because the four cases
 *  need different actions from the user, and "it failed" tells them none of them. English —
 *  the caller runs it through the UI translator like the other terminal hints. */
export function dropUploadErrorMessage(status: number | null): string {
  if (status === 413) return "That file is too large to send to the terminal.";
  if (status === 404) return "This terminal is no longer running, so the file could not be sent.";
  if (status === 403) return "The server refused the upload because the page's origin is not allowed.";
  return "Could not send the dropped file to the terminal.";
}

/** True when the file is over the cap. Checked here rather than left to the server's 413 so a
 *  large file fails at once instead of after uploading all of it. */
export const isTooLargeToDrop = (size: number): boolean => size > MAX_DROP_BYTES;

// The server is the only writer of this shape, but an old build or a proxy returning something
// else would otherwise put `undefined` into the terminal as if it were a path.
const isDropUploadResponse = (value: unknown): value is DropUploadResponse => isRecord(value) && typeof value.path === "string" && value.path !== "";

export async function uploadDroppedFile(sessionId: string, file: File): Promise<DropUploadResult> {
  if (isTooLargeToDrop(file.size)) return { ok: false, status: 413 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(dropUploadUrl(sessionId), {
      method: "POST",
      headers: { "content-type": file.type || FALLBACK_MIME, [DROP_FILENAME_HEADER]: encodeURIComponent(file.name) },
      body: file,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data: unknown = await res.json();
    return isDropUploadResponse(data) ? { ok: true, path: data.path } : { ok: false, status: null };
  } catch {
    return { ok: false, status: null }; // aborted, offline, or the host went away mid-upload
  } finally {
    clearTimeout(timer);
  }
}
