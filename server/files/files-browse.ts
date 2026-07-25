// Project-scoped file browsing + editing for the full-screen Files view. Takes a
// `?cwd=` project dir (the directory a terminal's session runs in) so each terminal
// browses/edits ITS OWN project. list/text/md are read-only GETs; write is a PUT.
//
// Security: the same loopback/trusted-local-user posture as the worktree/session
// endpoints — any absolute existing dir is an allowed base — but `path` is always
// contained within that base (no `..`/absolute escape), for reads AND writes. Rendered
// markdown is served under a sandbox CSP so embedded scripts can't run in the app origin.
import path from "node:path";
import fs from "node:fs";
import { marked } from "marked";
import type { Express, Request, Response } from "express";
import { resolveBase, containedPath, realContainedWithin } from "./pathContainment.js";

// Cap on the bytes served to the editor / accepted on write — a text editor, not a
// blob store. Large/binary files are refused rather than streamed into a textarea.
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

// Wrap marked's HTML output in a minimal, self-contained document (served sandboxed).
//
// Colours follow the READER's system theme rather than the app's: this document opens in its
// own tab under a sandbox CSP, so it cannot ask the app for its theme — and a hardcoded light
// page is a white flash for anyone reading in the dark. `color-scheme` is what gets the
// scrollbars and form controls to match; the media query does the rest.
export function mdToHtmlDoc(bodyHtml: string, title: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  const style = [
    ":root{color-scheme:light dark}",
    "body{max-width:48rem;margin:2rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.6;color:#1a1a2e;background:#fff}",
    "pre{background:#f4f4f4;padding:1rem;overflow:auto}code{font-family:ui-monospace,monospace}img{max-width:100%}",
    "a{color:#0b57d0}blockquote{margin:0;padding:0 1rem;border-left:4px solid #d0d0d8;color:#55555f}",
    "table{border-collapse:collapse}th,td{border:1px solid #d0d0d8;padding:.25rem .5rem}",
    "@media(prefers-color-scheme:dark){",
    "body{color:#e6e6ea;background:#16161a}",
    "pre{background:#232329}",
    "a{color:#8ab4f8}blockquote{border-left-color:#3a3a44;color:#a0a0aa}",
    "th,td{border-color:#3a3a44}",
    "}",
  ].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${style}</style></head><body>${bodyHtml}</body></html>`;
}

export interface BrowseEntry {
  name: string;
  dir: boolean;
  size: number;
}

// Directory listing, directories first then files, each alphabetical. Dotfiles are
// kept (a project's config often lives in them) but node_modules/.git are noisy —
// still listed; the UI can collapse them.
export function listEntries(absDir: string): BrowseEntry[] {
  return fs
    .readdirSync(absDir, { withFileTypes: true })
    .map((d) => {
      const dir = d.isDirectory();
      let size = 0;
      if (!dir) {
        try {
          size = fs.statSync(path.join(absDir, d.name)).size;
        } catch {
          size = 0;
        }
      }
      return { name: d.name, dir, size };
    })
    .sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1; // directories first
      return a.name.localeCompare(b.name);
    });
}

// Project base + relative path from a browse request's query. browseBase falls back to
// the server's default cwd; browseRel defaults to "" (the base itself).
const browseBase = (req: Request, defaultCwd: string): string => resolveBase(typeof req.query.cwd === "string" ? req.query.cwd : null, defaultCwd);
const browseRel = (req: Request): string => (typeof req.query.path === "string" ? req.query.path : "");

// Resolve `path` under the request's project base; 403 (and returns null) if it escapes —
// lexically OR through a symlink. One containment gate shared by every route (read + write).
function containedFor(req: Request, res: Response, defaultCwd: string): string | null {
  const base = browseBase(req, defaultCwd);
  const lexical = containedPath(base, browseRel(req));
  const abs = lexical ? realContainedWithin(base, lexical) : null;
  if (!abs) {
    res.status(403).json({ error: "path escapes the project root" });
    return null;
  }
  return abs;
}

export function mountFilesBrowseRoutes(app: Express, deps: { defaultCwd: string }): void {
  const { defaultCwd } = deps;

  app.get("/api/files/browse/list", (req, res) => {
    const root = browseBase(req, defaultCwd);
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    try {
      if (!fs.statSync(abs).isDirectory()) return res.status(400).json({ error: "not a directory" });
      res.json({ cwd: path.resolve(root), path: browseRel(req), entries: listEntries(abs) });
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });

  app.get("/api/files/browse/text", (req, res) => {
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) return res.status(400).json({ error: "not a file" });
      if (stat.size > MAX_EDIT_BYTES) return res.status(413).json({ error: "file too large to edit" });
      res.json({ text: fs.readFileSync(abs, "utf8") });
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });

  app.get("/api/files/browse/md", async (req, res) => {
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    let text: string;
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) return res.status(400).json({ error: "not a file" });
      // Same cap as /text and /write, so a huge file can't be read+parsed by marked.
      if (stat.size > MAX_EDIT_BYTES) return res.status(413).json({ error: "file too large" });
      text = fs.readFileSync(abs, "utf8");
    } catch {
      return res.status(404).json({ error: "not found" });
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    res.send(mdToHtmlDoc(await marked.parse(text), path.basename(abs)));
  });

  app.put("/api/files/browse/write", (req, res) => {
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    const text = req.body?.text;
    if (typeof text !== "string") return res.status(400).json({ error: "body.text (string) required" });
    if (Buffer.byteLength(text, "utf8") > MAX_EDIT_BYTES) return res.status(413).json({ error: "content too large" });
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return res.status(400).json({ error: "path is a directory" });
      fs.writeFileSync(abs, text, "utf8");
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "failed to write file" });
    }
  });
}
