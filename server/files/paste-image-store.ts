// Where a screenshot pasted into a terminal lands, and the pure helpers that decide its
// name and lifetime.
//
// MulmoClaude has the counterpart route (POST /api/attachments → data/attachments/YYYY/MM/)
// and this deliberately does NOT match it. There an attachment is CONTENT: the chat renders
// it again every time the conversation is reopened, so it is kept, sharded by month, and
// addressed workspace-relative. Here the file exists only because an agent reads paths and
// not clipboards — nothing ever looks at it twice. So it is a throwaway under the app's own
// home, addressed absolutely (that string goes straight into the terminal), and aged out
// rather than kept. Same gesture, different object; sharing the route would import the
// wrong meaning.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MULMOTERMINAL_HOME } from "../config/env.js";
import { extensionForImageMime } from "../../common/pastedImageTypes.js";

export const PASTE_IMAGE_DIR = path.join(MULMOTERMINAL_HOME, "tmp", "pasted");

// Two bounds, because either one alone leaves a hole: age catches the server that is
// restarted daily and would otherwise keep every screenshot forever, count catches the one
// left running for weeks.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KEEP_RECENT_FILES = 200;

const DATA_URL_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([\s\S]*)$/i;
// Buffer.from("...", "base64") is lenient — it drops whatever isn't base64 and returns the
// rest — so a corrupted payload becomes a corrupted file unless the charset and the
// four-character grouping are checked before decoding.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** The bytes behind a `data:<mime>;base64,...` URL, or null when it isn't one, isn't an
 *  image type we accept, or the payload isn't valid base64. */
export function decodeImageDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!extensionForImageMime(mime)) return null;
  const base64 = match[2].replace(/\s+/g, "");
  if (base64.length % 4 !== 0 || !BASE64_RE.test(base64)) return null;
  return { mime, bytes: Buffer.from(base64, "base64") };
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/** A screenshot arrives with no filename, so the timestamp is the name. `token` disambiguates
 *  it: the millisecond alone is not unique — two terminals (or two browser tabs) can paste
 *  into the same one, and the second write would then rename over the first, leaving the
 *  first terminal's inserted path pointing at someone else's screenshot. */
export function pasteImageFilename(now: Date, mime: string, token: string): string | null {
  const extension = extensionForImageMime(mime);
  if (!extension) return null;
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    "-",
    pad(now.getMilliseconds(), 3),
  ].join("");
  return `pasted-${stamp}-${token}${extension}`;
}

/** The disambiguating half of a pasted image's name. Short because the name is read by a
 *  human in a terminal, random because the timestamp is what it has to survive a tie with. */
export function pasteImageToken(): string {
  return randomUUID().slice(0, 8);
}

interface StoredImage {
  full: string;
  mtimeMs: number;
}

/** What is in the directory, newest first. An unreadable entry is skipped rather than
 *  thrown: pruning is housekeeping and must never fail the paste that triggered it. */
function storedImages(dir: string): StoredImage[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const full = path.join(dir, name);
      try {
        return { full, mtimeMs: fs.statSync(full).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is StoredImage => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function removeQuietly(full: string): void {
  try {
    fs.rmSync(full, { force: true });
  } catch {
    /* another writer got there first */
  }
}

/** Create the directory and drop what has aged out. Called at startup.
 *
 *  By AGE, not by emptying it: a tmux-backed session survives a server restart, so a
 *  conversation on the other side of one can still hold a path handed out before it — and a
 *  second server (a `yarn dev` beside the installed app) shares this directory. A wipe would
 *  delete files those sessions are still entitled to read.
 *
 *  Creating it eagerly matters for the sandbox: `docker run -v` on a missing host path
 *  creates it root-owned, and the container then writes where the user cannot. */
export function preparePasteImageDir(dir: string = PASTE_IMAGE_DIR, now_ms: number = Date.now(), maxAge_ms: number = MAX_AGE_MS): void {
  fs.mkdirSync(dir, { recursive: true });
  storedImages(dir)
    .filter(({ mtimeMs }) => now_ms - mtimeMs > maxAge_ms)
    .forEach(({ full }) => removeQuietly(full));
}

/** Drop all but the newest `keep` files — the bound on a server nobody restarts. */
export function prunePasteImages(dir: string, keep: number = KEEP_RECENT_FILES): void {
  storedImages(dir)
    .slice(keep)
    .forEach(({ full }) => removeQuietly(full));
}

/** The session's `--add-dir` list with the paste directory appended (#908 + #938).
 *  Claude Code refuses to read outside the working directory, so without this the inserted
 *  path costs the user a permission prompt on every paste — the very friction #938 removes.
 *  APPENDED, never substituted: the rest of the list is what the user asked for in their own
 *  `.mulmoterminal.json`, and MAX_ADD_DIRS caps that input, not what the app adds after it.
 *  The same list reaches the sandbox, where each entry becomes `-v <dir>:<dir>`, so a
 *  sandboxed session gets the mount from this too.
 *
 *  codex needs no counterpart: it has no `--add-dir`, and its sandbox restricts writes only
 *  (`workspace-write [workdir, /tmp, $TMPDIR]`) — reads of an absolute path anywhere work. */
export function withPasteImageDir(configured: string[] | null, dir: string = PASTE_IMAGE_DIR): string[] {
  return [...new Set([...(configured ?? []), dir])];
}
