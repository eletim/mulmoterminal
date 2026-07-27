// Where a screenshot pasted into a terminal lands, and the pure helpers that decide its
// name and lifetime.
//
// MulmoClaude has the counterpart route (POST /api/attachments → data/attachments/YYYY/MM/)
// and this deliberately does NOT match it. There an attachment is CONTENT: the chat renders
// it again every time the conversation is reopened, so it is kept, sharded by month, and
// addressed workspace-relative. Here the file exists only because an agent reads paths and
// not clipboards — nothing ever looks at it twice. So it is a throwaway under the app's own
// home, addressed absolutely (that string goes straight into the terminal), and wiped on
// startup. Same gesture, different object; sharing the route would import the wrong meaning.

import fs from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME } from "../config/env.js";

export const PASTE_IMAGE_DIR = path.join(MULMOTERMINAL_HOME, "tmp", "pasted");

// Bounded so a server left running for weeks can't grow the directory without limit —
// startup is the only other thing that empties it.
const KEEP_RECENT_FILES = 200;

// Formats Claude and codex both read. SVG is excluded on purpose: it is a script-bearing
// document, not a screenshot, and nothing puts one on the clipboard as an image.
const EXTENSION_BY_MIME: ReadonlyMap<string, string> = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
]);

export function extensionForImageMime(mime: string): string | null {
  return EXTENSION_BY_MIME.get(mime.toLowerCase().trim()) ?? null;
}

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

/** A screenshot arrives with no filename, so the timestamp is the name. Milliseconds are
 *  included because two pastes within the same second are one impatient user, not a rarity. */
export function pasteImageFilename(now: Date, mime: string): string | null {
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
  return `pasted-${stamp}${extension}`;
}

/** Empty the directory and recreate it. Called at startup — every path handed out by a
 *  previous run has already been read (or abandoned) by the session that asked for it.
 *  Creating it eagerly also matters for the sandbox: `docker run -v` on a missing host
 *  path creates it root-owned, and the container then writes where the user cannot. */
export function resetPasteImageDir(dir: string = PASTE_IMAGE_DIR): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/** Drop all but the newest `keep` files. Best-effort: a file that vanished under us (or
 *  that we may not delete) must not fail the paste that triggered the prune. */
export function prunePasteImages(dir: string, keep: number = KEEP_RECENT_FILES): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  if (names.length <= keep) return;
  const byNewest = names
    .map((name) => {
      const full = path.join(dir, name);
      try {
        return { full, mtimeMs: fs.statSync(full).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { full: string; mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  byNewest.slice(keep).forEach(({ full }) => {
    try {
      fs.rmSync(full, { force: true });
    } catch {
      /* another writer got there first */
    }
  });
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
