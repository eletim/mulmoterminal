// POST /api/paste-image — save an image pasted into a terminal and answer with its absolute
// path, which the client inserts at the cursor (issue #938). The browser can hand a terminal
// a path no other way: the clipboard carries bytes, and an agent reads paths.
//
// Deliberately NOT MulmoClaude's POST /api/attachments, whose managed-asset semantics don't
// apply here — see server/files/paste-image-store.ts for the comparison.

import type { Express } from "express";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { decodeImageDataUrl, pasteImageFilename, prunePasteImages, PASTE_IMAGE_DIR } from "./paste-image-store.js";

// A screenshot of a 6K display is a few MB; anything past this is not what this route is
// for. express.json() accepts 25MB and base64 inflates by 4/3, so the body still fits.
export const MAX_PASTE_IMAGE_BYTES = 10 * 1024 * 1024;

interface PasteImageOptions {
  dir?: string;
  now?: () => Date;
}

// Same-origin is already enforced for every state-changing request by the app-wide
// sameOriginGuard (routes/app-routes.ts), so this route adds no check of its own.
export function mountPasteImageRoute(app: Express, { dir = PASTE_IMAGE_DIR, now = () => new Date() }: PasteImageOptions = {}): void {
  app.post("/api/paste-image", async (req, res) => {
    const dataUrl = req.body?.dataUrl;
    if (typeof dataUrl !== "string") return res.status(400).json({ error: "body.dataUrl (string) required" });
    const decoded = decodeImageDataUrl(dataUrl);
    if (!decoded) return res.status(400).json({ error: "not a supported image data URL (png, jpeg, gif, webp)" });
    if (decoded.bytes.length > MAX_PASTE_IMAGE_BYTES) return res.status(413).json({ error: "image too large" });
    const filename = pasteImageFilename(now(), decoded.mime);
    if (!filename) return res.status(400).json({ error: "unsupported image type" });
    const abs = path.join(dir, filename);
    try {
      await writeFileAtomic(abs, decoded.bytes);
      prunePasteImages(dir);
      res.json({ path: abs });
    } catch {
      res.status(500).json({ error: "failed to save pasted image" });
    }
  });
}
