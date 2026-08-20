// Shared path-display helpers. They only format strings for UI labels; callers must keep using
// the original cwd for process launch, routing, and filesystem operations.

export function homeRelative(cwd: string, home: string | null): string {
  if (!home) return cwd;
  const windows = home.includes("\\") || /^[a-zA-Z]:/.test(home);
  const trimTrailingSeparators = (value: string) => {
    const min = windows && /^[a-zA-Z]:[\\/]*$/.test(value) ? 3 : value.startsWith("/") ? 1 : 0;
    let end = value.length;
    while (end > min && (value.charAt(end - 1) === "/" || value.charAt(end - 1) === "\\")) end -= 1;
    return value.slice(0, end);
  };
  const normalizedHome = trimTrailingSeparators(home);
  const normalizedCwd = trimTrailingSeparators(cwd);
  const matches = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (matches(normalizedCwd, normalizedHome)) return "~";
  const next = cwd.charAt(normalizedHome.length);
  if ((next === "/" || next === "\\") && matches(cwd.slice(0, normalizedHome.length), normalizedHome)) return `~${cwd.slice(normalizedHome.length)}`;
  return cwd;
}

export function truncateFront(s: string, max: number): string {
  return s.length <= max ? s : `…${s.slice(s.length - (max - 1))}`;
}
