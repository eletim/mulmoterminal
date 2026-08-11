import { normalizeBasePath, stripBasePath, withBasePath } from "../common/basePath";

export const APP_BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL);

const ROOT_SERVER_PATHS = ["/api", "/artifacts", "/htmlfile", "/mobile-web-push-sw.js", "/manifest.webmanifest", "/icons"];
const installedFetches = new WeakSet<typeof fetch>();

function shouldPrefixRootServerPath(pathname: string): boolean {
  return ROOT_SERVER_PATHS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

export function withAppBasePath(pathname: string): string {
  return withBasePath(pathname, APP_BASE_PATH);
}

export function stripAppBasePath(pathname: string): string {
  return stripBasePath(pathname, APP_BASE_PATH);
}

function rewriteRootServerUrl(input: string): string {
  if (APP_BASE_PATH === "/" || input === "") return input;
  if (input.startsWith("/")) return shouldPrefixRootServerPath(input) ? withAppBasePath(input) : input;
  if (typeof window === "undefined") return input;
  try {
    const url = new URL(input);
    if (url.origin !== window.location.origin || !shouldPrefixRootServerPath(url.pathname)) return input;
    url.pathname = withAppBasePath(url.pathname);
    return url.toString();
  } catch {
    return input;
  }
}

export function installBasePathFetch(): void {
  if (typeof window === "undefined" || APP_BASE_PATH === "/") return;
  const current = window.fetch;
  if (installedFetches.has(current)) return;

  const wrapped: typeof window.fetch = (input, init) => {
    if (typeof input === "string") return current(rewriteRootServerUrl(input), init);
    if (input instanceof URL) return current(new URL(rewriteRootServerUrl(input.toString())), init);
    if (typeof Request !== "undefined" && input instanceof Request) {
      const nextUrl = rewriteRootServerUrl(input.url);
      return current(nextUrl === input.url ? input : new Request(nextUrl, input), init);
    }
    return current(input, init);
  };
  installedFetches.add(wrapped);
  window.fetch = wrapped;
}
