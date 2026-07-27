// The pub/sub channel carrying "an agent just wrote this file". Both sides decide from it —
// the server publishes, the editor listens to know its open file moved under it — so the name
// and the payload shape live here rather than as a string literal on each side.
export const FILE_WRITE_CHANNEL = "file-write";

/** Absolute path, as the server resolved it. */
export interface FileWriteEvent {
  file: string;
}
