import { normalizeBasePath, stripBasePath, withBasePath } from "../common/basePath";

declare global {
  interface Window {
    __MULMOTERMINAL_BASE_PATH__?: string;
  }
}

const runtimeBasePath = typeof window === "undefined" ? undefined : window.__MULMOTERMINAL_BASE_PATH__;

export const APP_BASE_PATH = normalizeBasePath(runtimeBasePath ?? import.meta.env.BASE_URL);

const ROOT_SERVER_PATHS = ["/api", "/artifacts", "/htmlfile", "/mobile-web-push-sw.js", "/manifest.webmanifest", "/icons"];
const DOM_URL_ATTRIBUTES = new Set(["action", "href", "poster", "src"]);
const installedFetches = new WeakSet<typeof fetch>();
const installedDomWindows = new WeakSet<Window>();

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

function rewriteAttributeValue(name: string, value: unknown): string {
  const nextValue = String(value);
  return DOM_URL_ATTRIBUTES.has(name.toLowerCase()) ? rewriteRootServerUrl(nextValue) : nextValue;
}

function patchSetAttribute(): void {
  const original = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function setAttribute(name: string, value: string): void {
    original.call(this, name, rewriteAttributeValue(name, value));
  };
}

function patchUrlProperty<T extends Element>(prototype: object, property: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
  if (!descriptor?.set || !descriptor.get || !descriptor.configurable) return;
  const getter = descriptor.get;
  const setter = descriptor.set;

  Object.defineProperty(prototype, property, {
    configurable: true,
    enumerable: descriptor.enumerable ?? false,
    get(this: T) {
      return String(getter.call(this));
    },
    set(this: T, value: string) {
      setter.call(this, rewriteRootServerUrl(String(value)));
    },
  });
}

export function installBasePathDomUrls(): void {
  if (typeof window === "undefined" || APP_BASE_PATH === "/") return;
  if (installedDomWindows.has(window)) return;
  installedDomWindows.add(window);

  patchSetAttribute();
  patchUrlProperty<HTMLAnchorElement>(HTMLAnchorElement.prototype, "href");
  patchUrlProperty<HTMLFormElement>(HTMLFormElement.prototype, "action");
  patchUrlProperty<HTMLIFrameElement>(HTMLIFrameElement.prototype, "src");
  patchUrlProperty<HTMLImageElement>(HTMLImageElement.prototype, "src");
  patchUrlProperty<HTMLLinkElement>(HTMLLinkElement.prototype, "href");
  patchUrlProperty<HTMLScriptElement>(HTMLScriptElement.prototype, "src");
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
