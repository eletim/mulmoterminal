// Shared path-display helpers. They only format strings for UI labels; callers must keep using
// the original cwd for process launch, routing, and filesystem operations.

export function homeRelative(cwd: string, home: string | null): string {
  if (!home) return cwd;
  const windows = home.includes("\\") || /^[a-zA-Z]:/.test(home);
  const matches = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (matches(cwd, home)) return "~";
  const next = cwd.charAt(home.length);
  if ((next === "/" || next === "\\") && matches(cwd.slice(0, home.length), home)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

export function truncateFront(s: string, max: number): string {
  return s.length <= max ? s : `…${s.slice(s.length - (max - 1))}`;
}
