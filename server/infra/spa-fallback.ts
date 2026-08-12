import type { Express } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { basePathPrefix, normalizeBasePath } from "../../common/basePath.js";

// The SPA-fallback matcher for vue-router history mode. index.html is served for any
// client-side route — i.e. everything EXCEPT the /api prefix, which is where every
// server HTTP endpoint (including the GUI MCP route) lives. WebSocket upgrades
// (/ws, /ws/run, /ws/pubsub) bypass Express via server.on("upgrade"), and static
// assets are served by express.static before this runs — so reserving /api alone is
// enough. A GET to an unknown /api path is excluded here and falls through to a 404
// (never the SPA shell), so a mistyped API path fails loudly instead of returning HTML.
//
// Express 5 / path-to-regexp v8: app.get("*") is invalid — a RegExp route is used.
// The lookahead reserves the WHOLE /api prefix — both /api/... and the bare /api —
// so even a mistyped bare /api 404s rather than returning the SPA shell.
export const SPA_FALLBACK_RE = /^\/(?!api(?:\/|$)).*/;

/** True when `pathname` should serve the SPA shell rather than hit a server route. */
export function isClientRoute(pathname: string): boolean {
  return SPA_FALLBACK_RE.test(pathname);
}

/** Serve `distDir/index.html` for every client route.
 *
 *  The `root` option is the whole point (#954). Without it `send` runs its dotfile check over
 *  the ABSOLUTE path, and the default `dotfiles: "ignore"` answers 404 for any install whose
 *  path contains a dot segment — which every `npx` run does, since the package is expanded
 *  under `~/.npm/_npx/`. With a root, only what sits BELOW it is examined, so where the app
 *  happens to be installed stops mattering. The `express.static` above already passes one,
 *  which is why the assets loaded and only the deep link 404'd.
 *
 *  Mounted as a function so a test can drive the real thing on a bare app: mountAppRoutes wants
 *  a dependency object the size of the server, and the spec that existed checked the route
 *  PATTERN only — it stayed green through the whole bug. */
const RUNTIME_BASE_RE = /window\.__MULMOTERMINAL_BASE_PATH__\s*=\s*"[^"]*";/;
const ROOT_DIST_URL_RE = /\b(href|src)="\/(assets|icons|manifest\.webmanifest|mobile-web-push-sw\.js)([^"]*)"/g;
const ROOT_CSS_ASSET_URL_RE = /url\((["']?)\/(assets\/[^)"']+)\1\)/g;

function safeDistFilePath(distDir: string, requestPath: string): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(requestPath).replace(/^\/+/, "");
  } catch {
    return null;
  }

  const root = path.resolve(distDir);
  const target = path.resolve(root, relative);
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = err.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export function renderIndexHtml(html: string, basePath: string | null | undefined): string {
  const normalized = normalizeBasePath(basePath);
  const prefix = basePathPrefix(normalized);
  return html
    .replace(RUNTIME_BASE_RE, `window.__MULMOTERMINAL_BASE_PATH__ = ${JSON.stringify(normalized)};`)
    .replace(ROOT_DIST_URL_RE, (_match: string, attr: string, rootPath: string, rest: string) => `${attr}="${prefix}/${rootPath}${rest}"`);
}

export function renderAssetCss(css: string, basePath: string | null | undefined): string {
  const prefix = basePathPrefix(basePath);
  if (!prefix) return css;
  return css.replace(ROOT_CSS_ASSET_URL_RE, (_match: string, quote: string, assetPath: string) => `url(${quote}${prefix}/${assetPath}${quote})`);
}

export function mountBasePathAssetCss(app: Pick<Express, "get">, distDir: string, options: { basePath?: string } = {}): void {
  app.get(/^\/assets\/.*\.css$/, async (req, res, next) => {
    if (basePathPrefix(options.basePath) === "") return next();
    const filePath = safeDistFilePath(distDir, req.path);
    if (!filePath) return next();

    try {
      const css = await fs.readFile(filePath, "utf8");
      res.type("css").send(renderAssetCss(css, options.basePath));
    } catch (err) {
      if (errorCode(err) === "ENOENT") return next();
      next(err);
    }
  });
}

export function mountSpaFallback(app: Pick<Express, "get">, distDir: string, options: { basePath?: string } = {}): void {
  app.get(SPA_FALLBACK_RE, async (_req, res, next) => {
    try {
      const html = await fs.readFile(path.join(distDir, "index.html"), "utf8");
      res.type("html").send(renderIndexHtml(html, options.basePath));
    } catch (err) {
      next(err);
    }
  });
}
