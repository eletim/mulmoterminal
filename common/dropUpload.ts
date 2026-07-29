// The wire contract for sending a dropped file's bytes to the host, when the browser withheld
// its path. Both sides decide from these: the server enforces the cap and the browser refuses
// early rather than spending a long upload on bytes that will be rejected at the end.

// Matches the phone's attachment ingest, so the same file is accepted whichever way it arrives.
export const MAX_DROP_BYTES = 110 * 1024 * 1024;

// A header, not a body field, because the body IS the file. Percent-encoded by the sender: a
// header is latin-1 and real filenames are not, so a Japanese name sent raw arrives mangled.
export const DROP_FILENAME_HEADER = "x-drop-filename";

// What POST /api/session/:id/drop answers with on success. `path` is absolute, inside the
// directory that session was granted at spawn time.
export interface DropUploadResponse {
  path: string;
}
