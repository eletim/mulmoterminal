// The wire shape for a terminal row's SGR styling (#7's ANSI colours on the phone), shared
// because it is decided by BOTH sides: the server resolves an escape sequence's colour codes
// down to this shape (server/session/ansiSegments.ts, server/session/headlessScreen.ts), and
// the mobile page (src/components/MobileTerminalPage.vue) is the only reader.
//
// Colours are pre-resolved to concrete hex strings server-side — the phone never sees a raw
// SGR code, an index it has to look up, or an escape sequence it has to parse. It renders each
// segment's `text` through Vue's normal `{{ }}` interpolation (auto-escaped, never innerHTML)
// and applies `fg`/`bg`/`bold` as a `:style` object, which Vue sets via direct CSSStyleDeclaration
// property assignment — a value that isn't a valid CSS colour is simply dropped by the browser,
// never interpreted as markup or script. That is what keeps arbitrary terminal output safe to
// display without a sanitizer: the untrusted part (arbitrary bytes an agent printed) only ever
// travels as one field's *text content*, never as HTML, an attribute name, or a style property
// name.
import { isRecord } from "./isRecord.js";
import { isUnknownArray } from "./isUnknownArray.js";

export interface AnsiSegment {
  text: string;
  // "#rrggbb", or null for "leave it at the page's default foreground/background" — the same
  // null a segment with no colour code in effect resolves to, so plain, colourless output (the
  // common case) costs no style object entries at all.
  fg: string | null;
  bg: string | null;
  bold: boolean;
}

// One captured terminal row, left to right. An empty array is a blank line — still a row, so
// row COUNT (and therefore line breaks) survives even when every line is colourless.
export type AnsiRow = AnsiSegment[];

export const isAnsiSegment = (value: unknown): value is AnsiSegment =>
  isRecord(value) &&
  typeof value.text === "string" &&
  (value.fg === null || typeof value.fg === "string") &&
  (value.bg === null || typeof value.bg === "string") &&
  typeof value.bold === "boolean";

export const isAnsiRow = (value: unknown): value is AnsiRow => isUnknownArray(value) && value.every(isAnsiSegment);

// A full styled screen: one AnsiRow per line, same row count and order as the plain-text
// `screen` field it accompanies. Optional on the wire — see MobileTerminalPage.vue's
// isMobileScreen — so an older server, or a session the styling step failed for, still shows
// the plain-text screen it always has, rather than nothing.
export const isAnsiScreen = (value: unknown): value is AnsiRow[] => isUnknownArray(value) && value.every(isAnsiRow);
