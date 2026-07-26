// The xterm font-family stack. Shared because both sides decide from it: the server validates
// `.mulmoterminal.json` and `config.json`, and the client re-validates what comes off the wire
// and supplies the fallback when neither file names one.

// Latin comes first, so an existing install's ASCII rendering is unchanged. The CJK block after it
// is named explicitly rather than left to the generic `monospace` fallback: the face a browser picks
// for an unnamed glyph is not required to be em-square, and xterm reserves exactly TWO cells for a
// fullwidth character — a face whose fullwidth advance isn't exactly twice the Latin one tears every
// box-drawing frame, which is most of what an agent TUI draws. Japanese precedes the other CJK
// locales because a stack that reached `…CJK SC` first would draw kanji with mainland glyph shapes.
export const TERMINAL_FONT_FAMILY_DEFAULT = [
  "'JetBrains Mono'",
  "'Fira Code'",
  "Menlo",
  "Consolas",
  "'Noto Sans Mono CJK JP'",
  "'Hiragino Sans'",
  "'BIZ UDGothic'",
  "'MS Gothic'",
  "IPAGothic",
  "'Noto Sans Mono CJK KR'",
  "'Malgun Gothic'",
  "'Noto Sans Mono CJK SC'",
  "'Microsoft YaHei'",
  "'Noto Sans Mono CJK TC'",
  "'Microsoft JhengHei'",
  "monospace",
].join(", ");

// Long enough for a hand-written stack of a dozen names, short enough that the value stays a font
// list rather than a place to park arbitrary text.
export const TERMINAL_FONT_FAMILY_MAX_CHARS = 400;

// The portable half of the rule, for the JSON Schema shipped with the config skill. A JSON Schema
// `pattern` is ECMA-262 WITHOUT the `u` flag, so it cannot use the `\p{L}` classes the exact rule
// below needs to accept font names in every script. It denies the CSS syntax that makes a value
// dangerous or silently breaking, and leaves the per-entry structure to normalizeFontFamily at
// load time. A spec pins that whatever the exact rule accepts, this accepts too.
export const TERMINAL_FONT_FAMILY_SAFE_RE = /^[^;{}()<>\\/@!]+$/;

// One entry of the list: a leading letter or digit, then letters of ANY script (`游ゴシック` and
// `ＭＳ ゴシック` are real font names and must pass), digits, combining marks, spaces of any width,
// and the three separators real font names use. Everything CSS treats as syntax, plus quotes and
// control characters, is outside it and stays out.
const FONT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Zs}._-]*$/u;

// CSS falls back to the browser's default when no named family matched, and that default is
// PROPORTIONAL — an xterm rendered in it has every column misaligned, with nothing on screen to
// explain why. So a stack that names no generic family gets `monospace` appended.
const GENERIC_FAMILIES = new Set(["monospace", "ui-monospace", "system-ui", "serif", "sans-serif", "cursive", "fantasy"]);

// Quotes are legal, but only as a matching pair around a whole entry: a stray one unbalances the
// CSS declaration, which invalidates it entirely rather than just that entry.
function isFontName(entry: string): boolean {
  const quote = entry[0] === "'" || entry[0] === '"' ? entry[0] : "";
  if (!quote) return FONT_NAME_RE.test(entry);
  return entry.length >= 3 && entry.endsWith(quote) && FONT_NAME_RE.test(entry.slice(1, -1));
}

// Deliberately unquoted-only. In CSS a generic family is a KEYWORD: quoting it turns it into a
// lookup for a font literally named "monospace", which resolves nowhere and provides no fallback.
// Counting a quoted one as satisfying the rule below would skip the append in precisely the case
// the append exists to catch.
const isGenericFamily = (entry: string): boolean => GENERIC_FAMILIES.has(entry.toLowerCase());

// Reject the whole stack on a bad entry, where normalizeFontSize clamps: a size is a continuous
// quantity, so honouring the direction the user asked for beats ignoring it, but a stack is one
// intent — dropping half of it would render in a font the author never named. Returning null lets
// the caller fall back to the level below (dir → global → default).
export function normalizeFontFamily(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const stack = input.trim();
  if (!stack || stack.length > TERMINAL_FONT_FAMILY_MAX_CHARS) return null;
  const names = stack.split(",").map((name) => name.trim());
  if (!names.every(isFontName)) return null;
  return [...names, ...(names.some(isGenericFamily) ? [] : ["monospace"])].join(", ");
}
