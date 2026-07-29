// Receiving a file the browser would not give us a path for.
//
// The bytes arrive raw under the file's OWN content type rather than as JSON, for two reasons:
// base64 in a JSON body inflates by a third (so the existing 25mb parser would cap real files
// near 18MB), and a dropped .json would be parsed as a document instead of stored as a file.
//
// Nothing in the request names a path — only bytes, a type, and the original filename, which is
// used for its suffix alone. The saved path is the server's (see session/session-drops.ts).
import express, { type Express, type Request } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import { ptys } from "../session/registry.js";
import { saveDrop } from "../session/session-drops.js";
import { DROP_FILENAME_HEADER, MAX_DROP_BYTES, type DropUploadResponse } from "../../common/dropUpload.js";

const FALLBACK_MIME = "application/octet-stream";

// The filename rides percent-encoded because a header is latin-1 and real filenames are not —
// a Japanese name sent raw arrives mangled or breaks the request outright. Undecodable means
// we simply do not know the name; the extension then comes from the content type.
function originalFilename(req: Request): string | null {
  const raw = req.get(DROP_FILENAME_HEADER);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function mountDropRoutes(app: Express): void {
  app.post("/api/session/:id/drop", express.raw({ type: () => true, limit: MAX_DROP_BYTES }), (req, res) => {
    const id = req.params.id;
    if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
    // The session's directory is granted at spawn time, so a drop for a session this server is
    // not running has nowhere it could be read from even if it were saved.
    if (!ptys.has(id)) return res.status(404).json({ error: "no such session" });
    const bytes: unknown = req.body;
    // Length is NOT checked: an empty file is a real file, and refusing it here would mean the
    // same drop succeeds in a browser that exposes the path and fails in one that does not —
    // the browser-dependent behaviour this route exists to remove (found by Codex review).
    if (!Buffer.isBuffer(bytes)) return res.status(400).json({ error: "a raw body is required" });
    try {
      const body: DropUploadResponse = { path: saveDrop(id, bytes, req.get("content-type") ?? FALLBACK_MIME, originalFilename(req)) };
      res.json(body);
    } catch (err) {
      console.error(`[drops] could not save a dropped file for ${id}:`, err);
      res.status(500).json({ error: "could not save the dropped file" });
    }
  });
}
