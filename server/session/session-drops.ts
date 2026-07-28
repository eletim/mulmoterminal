// Where a dropped file's bytes land when the browser withheld its path.
//
// Structured like session-settings.ts, and for the same reason: the files belong to one
// session, so reap() drops them, and a boot sweep drops what a crash never reached.
//
// The directory is what differs. os.tmpdir() is SHARED with every other program and user on
// the host, which drives two rules here — the tree is 0700, and the sweep only ever removes a
// directory whose name is a session id we could have minted. "The parent is ours" is not a
// good enough reason to delete something we did not write.
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { removeQuietly } from "../infra/fs-cleanup.js";
import { SESSION_ID_RE } from "../config/env.js";
import { extensionForMime } from "../backends/remoteHost/attachment-path.js";

// One parent for every session's drops, so the sweep reads a directory of ours instead of
// walking the whole of tmp.
export const DROPS_ROOT = path.join(os.tmpdir(), "mulmoterminal-drops");

// tmp is world-readable by default, and a dropped file is whatever the user had open.
const PRIVATE_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

// A suffix taken from the client's filename. Alphanumeric and short: enough for `tsx` or
// `jpeg`, and nothing that could reshape a path or collide with the `.tmp` staging name.
const SAFE_EXTENSION = /^[A-Za-z0-9]{1,16}$/;

/** The session's drop directory, or null when `sessionId` is not one we could have minted.
 *  Callers already hold an id from randomUUID() or a SESSION_ID_RE match; re-checking is what
 *  keeps a crafted id from naming a path outside DROPS_ROOT. */
export function dropsDir(sessionId: string): string | null {
  return SESSION_ID_RE.test(sessionId) ? path.join(DROPS_ROOT, sessionId) : null;
}

/** The extension a saved drop should carry.
 *
 *  The FILENAME is consulted before the MIME type because a browser's type for a source file
 *  is unreliable in a way that matters here: `.ts` is commonly reported as video/mp2t and most
 *  code files as an empty string, so a MIME-first rule renames the everyday case to `.bin` and
 *  the agent then reads a file whose type it cannot tell. Only the suffix is taken, and only
 *  when it is plainly a suffix — the name itself is never used (see saveDrop). */
export function dropExtension(filename: string | null, mimeType: string): string {
  const suffix = typeof filename === "string" ? filename.slice(filename.lastIndexOf(".") + 1) : "";
  if (filename?.includes(".") && SAFE_EXTENSION.test(suffix)) return `.${suffix.toLowerCase()}`;
  return extensionForMime(mimeType);
}

/** Create the session's drop directory and return its path, or null when it could not be
 *  prepared. Never throws: a spawn must not fail because a drop target is unavailable — the
 *  caller simply grants no extra directory, and drops fall back to the old hint. */
export function ensureDropsDir(sessionId: string): string | null {
  const dir = dropsDir(sessionId);
  if (!dir) return null;
  try {
    mkdirSync(dir, { recursive: true, mode: PRIVATE_MODE });
    return dir;
  } catch (err) {
    console.warn(`[drops] could not create ${dir}: ${String(err)}`);
    return null;
  }
}

/** Persist a dropped file, returning its absolute path.
 *
 *  Written to a staging name and renamed, so the path handed to the terminal never names a
 *  half-written file. The NAME is ours: the request carries no path at all, only bytes and a
 *  type, which is what leaves nothing to sanitize. */
export function saveDrop(sessionId: string, bytes: Buffer, mimeType: string, filename: string | null = null): string {
  const dir = ensureDropsDir(sessionId);
  if (!dir) throw new Error(`no drop directory for session ${sessionId}`);
  const absPath = path.join(dir, `${randomUUID()}${dropExtension(filename, mimeType)}`);
  const staging = `${absPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(staging, bytes, { mode: PRIVATE_FILE_MODE });
    renameSync(staging, absPath);
  } catch (err) {
    removeQuietly(staging);
    throw err;
  }
  return absPath;
}

/** Drop a session's files. Safe to call for sessions that never received one. */
export function cleanupSessionDrops(sessionId: string): void {
  const dir = dropsDir(sessionId);
  if (dir) removeQuietly(dir);
}

/** Remove the drop directories no surviving session owns.
 *
 *  cleanupSessionDrops runs from reap(), which a crash — or a machine losing power — never
 *  reaches, and what stays behind is a copy of whatever the user dropped. `liveIds` is what
 *  actually survived the restart: the tmux sessions still running. Nothing else can still be
 *  reading its drops, since a PTY without tmux died with the server that owned it.
 *
 *  Returns the ids it dropped, for the boot log. */
export function pruneOrphanDrops(liveIds: ReadonlySet<string>, root: string = DROPS_ROOT): string[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return []; // nothing has been dropped yet
  }
  const dropped: string[] = [];
  for (const name of names) {
    if (!SESSION_ID_RE.test(name) || liveIds.has(name)) continue;
    if (removeQuietly(path.join(root, name))) dropped.push(name);
  }
  return dropped;
}
