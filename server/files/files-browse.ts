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
import { htmlDoc, jsonHtmlDoc, tableHtmlDoc, delimiterForExtension } from "./renderedDoc.js";

// Cap on the bytes served to the editor / accepted on write — a text editor, not a
// blob store. Large/binary files are refused rather than streamed into a textarea.
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

/** Wrap marked's HTML output in the shared self-contained document (served sandboxed). */
export const mdToHtmlDoc = (bodyHtml: string, title: string): string => htmlDoc(bodyHtml, title);

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

type RenderDoc = (text: string, title: string) => string | Promise<string>;

// The file's text, or null with the response already answered. Shared by the rendered views
// so "directory / too large / missing" reads the same from every one of them.
function readTextOr4xx(res: Response, abs: string): string | null {
  try {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      res.status(400).json({ error: "not a file" });
      return null;
    }
    // The same cap as /text and /write: a huge file must not be read and parsed into memory.
    if (stat.size > MAX_EDIT_BYTES) {
      res.status(413).json({ error: "file too large" });
      return null;
    }
    return fs.readFileSync(abs, "utf8");
  } catch {
    res.status(404).json({ error: "not found" });
    return null;
  }
}

// A rendered view (#808): read the file the same guarded way, answer with a self-contained
// document under the sandbox CSP. Only the rendering differs between routes, so that is all
// the caller supplies.
function mountRenderedRoute(app: Express, routePath: string, defaultCwd: string, render: RenderDoc): void {
  app.get(routePath, async (req, res) => {
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    const text = readTextOr4xx(res, abs);
    if (text === null) return;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    res.send(await render(text, path.basename(abs)));
  });
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

  const serveRendered = (routePath: string, render: RenderDoc) => mountRenderedRoute(app, routePath, defaultCwd, render);

  serveRendered("/api/files/browse/md", async (text, title) => htmlDoc(await marked.parse(text), title));
  serveRendered("/api/files/browse/json", (text, title) => jsonHtmlDoc(text, title));
  // The delimiter comes from the file's own extension, so one route serves .csv and .tsv.
  serveRendered("/api/files/browse/table", (text, title) => tableHtmlDoc(text, title, delimiterForExtension(path.extname(title))));

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
