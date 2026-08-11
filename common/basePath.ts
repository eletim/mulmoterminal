export const DEFAULT_BASE_PATH = "/";

function pathOnly(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? "";
}

export function normalizeBasePath(raw: string | null | undefined): string {
  const value = pathOnly(String(raw ?? "").trim());
  if (value === "" || value === "/") return DEFAULT_BASE_PATH;
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

export function basePathPrefix(basePath: string | null | undefined): string {
  const normalized = normalizeBasePath(basePath);
  return normalized === DEFAULT_BASE_PATH ? "" : normalized.slice(0, -1);
}

export function withBasePath(pathname: string, basePath: string | null | undefined): string {
  const prefix = basePathPrefix(basePath);
  if (!prefix || !pathname.startsWith("/")) return pathname;
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return pathname;
  return `${prefix}${pathname}`;
}

export function stripBasePath(pathname: string, basePath: string | null | undefined): string {
  const prefix = basePathPrefix(basePath);
  if (!prefix) return pathname;
  if (pathname === prefix) return "/";
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length) || "/";
  return pathname;
}
