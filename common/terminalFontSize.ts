// The xterm font size, in px. Shared because all three sides decide from the same numbers:
// the server validates `.mulmoterminal.json`, the Settings stepper bounds its own buttons, and
// the client validates what it reads back out of localStorage.
export const TERMINAL_FONT_SIZE_DEFAULT = 14;
// Below ~8px the canvas renderer's glyphs stop being legible; above ~32px a grid cell holds so
// few columns that Claude's output wraps into noise. Neither is a hard xterm limit — they bound
// the stepper and reject a value that would leave the terminal unusable.
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;
export const TERMINAL_FONT_SIZE_STEP = 1;

// Clamp rather than reject an out-of-range number: for a size, honouring the direction the user
// asked for reads as working, where falling back to the default reads as ignored. Non-numeric
// input is a different thing — "nothing configured here" — so it stays null and lets the caller
// fall back. Fractional sizes round: xterm accepts them, but they make cell metrics drift from
// the integer the UI shows.
export function normalizeFontSize(input: unknown): number | null {
  if (typeof input !== "number" || !Number.isFinite(input)) return null;
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(input)));
}
