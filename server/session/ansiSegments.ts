// Turns one row of a `tmux capture-pane -e` string into the styled segments the phone renders
// (#7 — ANSI colour on /mobile/terminals). Reuses screen-rows.ts's own escape splitter (the
// regex already proven against real Claude Code / Codex panes in screen-rows.spec.ts) rather
// than deriving a second boundary for the same escape shapes, and generalizes its `dimAfter`
// SGR walk (dim is a single boolean; this tracks foreground, background and bold) — same
// left-to-right param scan, same "skip an extended colour's own arguments" rule for 38/48/58.
//
// Deliberately does NOT reuse a general ANSI library: capture-pane -e only ever emits SGR and
// OSC 8 hyperlinks (screen-rows.ts's own comment), and every other escape shape is dropped here
// exactly as it already is for the plain-text `screen` field.
import { ESCAPE_SPLIT, SGR } from "./screen-rows.js";
import { SCREEN_HISTORY_ROWS, SCREEN_MAX_BYTES } from "../mobileTerminal/terminalScreen.js";
import type { AnsiRow, AnsiSegment } from "../../common/ansiStyle.js";

// The classic 16-colour terminal palette, tuned to read on both a light and a dark page (this
// component owns its own fixed dark background — MobileTerminalPage.vue — precisely so these
// don't have to adapt to the surrounding theme; see the note there). "Black" is a dark grey
// rather than pure black, same as most terminal apps default it to, since pure black text would
// be unreadable against that background.
const ANSI_16 = [
  "#545862", // 0 black
  "#e06c75", // 1 red
  "#98c379", // 2 green
  "#e5c07b", // 3 yellow
  "#61afef", // 4 blue
  "#c678dd", // 5 magenta
  "#56b6c2", // 6 cyan
  "#abb2bf", // 7 white
  "#5c6370", // 8 bright black
  "#ef596f", // 9 bright red
  "#a5e075", // 10 bright green
  "#f0c674", // 11 bright yellow
  "#6cb6ff", // 12 bright blue
  "#d68fdd", // 13 bright magenta
  "#6cd6d0", // 14 bright cyan
  "#ffffff", // 15 bright white
] as const;

// The 6x6x6 colour cube xterm's 256-colour palette builds indices 16-231 from.
const CUBE_STEP = [0, 95, 135, 175, 215, 255] as const;

const toHex = (r: number, g: number, b: number): string =>
  "#" +
  [r, g, b]
    .map((n) =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

// Resolves one xterm palette index (0-255, the value SGR 30-37/90-97/38;5;n all reduce to) to a
// concrete colour. Exported for headlessScreen.ts's cell-based path (#7's other capture route),
// so both ends of the fallback resolve indices identically without a second copy of this table.
export const resolveIndexColor = (index: number): string => {
  if (index < 16) return ANSI_16[index] ?? ANSI_16[0];
  if (index < 232) {
    const cube = index - 16;
    const r = CUBE_STEP[Math.floor(cube / 36) % 6] ?? 0;
    const g = CUBE_STEP[Math.floor(cube / 6) % 6] ?? 0;
    const b = CUBE_STEP[cube % 6] ?? 0;
    return toHex(r, g, b);
  }
  const level = 8 + (Math.min(255, index) - 232) * 10;
  return toHex(level, level, level);
};

export const rgbHex = (r: number, g: number, b: number): string => toHex(r, g, b);

interface SgrState {
  fg: string | null;
  bg: string | null;
  bold: boolean;
}

const RESET_STATE: SgrState = { fg: null, bg: null, bold: false };

// 38/48/58 (fg/bg/underline colour) each take either "5;<0-255>" (palette) or "2;<r>;<g>;<b>"
// (truecolor) as their OWN arguments — consumed here so the codes after them are read as the
// NEXT attribute, not misread as part of this one. Mirrors screen-rows.ts's dimAfter, which
// skips the same shapes for the same reason without caring what colour they name.
const extendedColor = (params: readonly string[]): { color: string | null; rest: readonly string[] } => {
  const mode = params[0];
  if (mode === "5") {
    const index = Number(params[1]);
    return { color: Number.isFinite(index) ? resolveIndexColor(index) : null, rest: params.slice(2) };
  }
  if (mode === "2") {
    const [r, g, b] = [Number(params[1]), Number(params[2]), Number(params[3])];
    const color = [r, g, b].every((n) => Number.isFinite(n)) ? rgbHex(r, g, b) : null;
    return { color, rest: params.slice(4) };
  }
  // An unrecognised extended-colour mode (legacy "38;3;…" CMY, or a truncated sequence with no
  // mode byte at all) — drop just the mode byte so a later, well-formed code doesn't get read
  // as this one's leftover argument.
  return { color: null, rest: params.slice(1) };
};

// Codes that map onto exactly one state change, independent of any other code — split out of
// sgrAfter so its own branching is just "which kind of code is this", not "what does every one
// of them do" (that used to be one function with a branch per code, over the sonar/eslint
// complexity ceiling).
const NAMED_CODES: Readonly<Record<string, (state: SgrState) => SgrState>> = {
  "": () => RESET_STATE,
  "0": () => RESET_STATE,
  "1": (state) => ({ ...state, bold: true }),
  // 22 cancels bold AND dim (dim isn't tracked here, it belongs to screen-rows.ts's own scan).
  "22": (state) => ({ ...state, bold: false }),
  "39": (state) => ({ ...state, fg: null }),
  "49": (state) => ({ ...state, bg: null }),
};

// The four numeric ranges SGR uses for a plain palette colour (30-37/90-97 foreground,
// 40-47/100-107 background) — each range's own colour index is `code - base`.
const COLOR_RANGES: readonly { min: number; max: number; base: number; target: "fg" | "bg" }[] = [
  { min: 30, max: 37, base: 30, target: "fg" },
  { min: 90, max: 97, base: 82, target: "fg" },
  { min: 40, max: 47, base: 40, target: "bg" },
  { min: 100, max: 107, base: 92, target: "bg" },
];

const paletteColorCode = (n: number): { target: "fg" | "bg"; color: string | null } | undefined => {
  const range = COLOR_RANGES.find((candidate) => n >= candidate.min && n <= candidate.max);
  return range && { target: range.target, color: ANSI_16[n - range.base] ?? null };
};

// 38/48 apply an extended colour to fg/bg; 58 (underline colour) is parsed the same shape but
// this renderer draws no underline, so its colour is discarded — its ARGS are still consumed,
// which is the part that matters (skipping them keeps the codes after it from desyncing).
const extendedColorPatch = (code: "38" | "48" | "58", rest: readonly string[]): { patch: Partial<SgrState>; rest: readonly string[] } => {
  const { color, rest: after } = extendedColor(rest);
  if (code === "38") return { patch: { fg: color }, rest: after };
  if (code === "48") return { patch: { bg: color }, rest: after };
  return { patch: {}, rest: after };
};

// Walks one SGR sequence's semicolon-separated params left to right, folding them onto the
// style in effect. Recursive rather than a loop, matching dimAfter's shape (and its rationale:
// an escape can carry several attributes in one sequence, e.g. "1;31" for bold red).
const sgrAfter = (state: SgrState, params: readonly string[]): SgrState => {
  const [code, ...rest] = params;
  if (code === undefined) return state;
  const named = NAMED_CODES[code];
  if (named) return sgrAfter(named(state), rest);
  if (code === "38" || code === "48" || code === "58") {
    const { patch, rest: after } = extendedColorPatch(code, rest);
    return sgrAfter({ ...state, ...patch }, after);
  }
  const palette = paletteColorCode(Number(code));
  if (palette) return sgrAfter({ ...state, [palette.target]: palette.color }, rest);
  // Every other SGR code (italic, underline, blink, inverse, strikethrough, …) is out of scope
  // for #7 and safely ignored — the style already in effect just carries through unchanged.
  return sgrAfter(state, rest);
};

// Splits only on ";" — an SGR sequence using ITU-T.416's COLON-separated sub-parameter form
// (e.g. "38:2::10:20:30", rather than the semicolon form "38;2;10;20;30") is left as one
// unsplit token, so its 38/48 never matches and the colour is silently dropped (never shown
// wrong, never crashes — just not decoded). Deliberately not handled: `tmux capture-pane -e` —
// the only producer of the text this parses — has always re-emitted SGR with semicolons, so a
// real capture never contains the colon form. screen-rows.ts's own dimAfter has the identical
// limitation for the same reason and was never extended for it either. The OTHER capture route
// (headlessScreen.ts's renderAnsiRows) is unaffected regardless: it reads @xterm/headless's own
// resolved cell state, which parses both forms correctly on its own.
const sgrOfEscape = (sequence: string, state: SgrState): SgrState => {
  const sgr = SGR.exec(sequence);
  return sgr === null ? state : sgrAfter(state, (sgr[1] ?? "").split(";"));
};

interface FoldState {
  segments: AnsiSegment[];
  current: string;
  style: SgrState;
}

// Closes the run in progress, if any, into a segment. Called before the style changes (a new
// escape lands) and once more at the end of the row.
const flush = (state: FoldState): FoldState =>
  state.current === "" ? state : { segments: [...state.segments, { text: state.current, ...state.style }], current: "", style: state.style };

// Splitting on ESCAPE_SPLIT's capturing group yields text and escapes alternately (odd indices
// are escapes), same as screen-rows.ts's own foldPart.
const foldPart = (state: FoldState, part: string, index: number): FoldState => {
  if (index % 2 === 0) return { ...state, current: state.current + part };
  const flushed = flush(state);
  return { ...flushed, style: sgrOfEscape(part, flushed.style) };
};

// Scanned by index rather than matched with a trailing-space regex, which backtracks
// quadratically on a string that is mostly spaces — the same reasoning (and the same fix)
// as screen-rows.ts's own withoutTrailingPad.
const stripTrailingSpaces = (text: string): string => text.slice(0, text.split("").findLastIndex((char) => char !== " ") + 1);

// Only the ASCII space is padding (capture-pane -e paints a coloured background to the pane's
// full width; capture-pane without -e does not, and the phone is shown the -p screen's width).
// Claude Code's empty input box is "❯" + U+00A0, which must survive — same rule and same
// reasoning as screen-rows.ts's withoutTrailingPad, reimplemented here because it has to trim
// across segment boundaries rather than one flat string.
export const trimTrailingPad = (segments: readonly AnsiSegment[]): AnsiSegment[] => {
  const trimmed = [...segments];
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    if (last === undefined) break;
    const stripped = stripTrailingSpaces(last.text);
    if (stripped === last.text) break;
    trimmed.pop();
    if (stripped !== "") trimmed.push({ ...last, text: stripped });
  }
  return trimmed;
};

export const parseAnsiRow = (line: string): AnsiRow => {
  const folded = line.split(ESCAPE_SPLIT).reduce(foldPart, { segments: [], current: "", style: RESET_STATE });
  return trimTrailingPad(flush(folded).segments);
};

export const parseAnsiRows = (styled: string): AnsiRow[] => styled.split("\n").map(parseAnsiRow);

const rowText = (row: AnsiRow): string => row.map((segment) => segment.text).join("");

// The plain text `styledScreen` would show with every colour stripped — used ONLY to check that
// styledScreen and the plain-text `screen` field it accompanies came from the SAME underlying
// capture (server/routes/local-mobile-terminal-routes.ts's consistency check, #7 round-3
// review), mirroring rowsToScreen's job for ScreenRow[]. Both parsers extract text identically
// off the same raw capture, so this equals `screen.screen` byte for byte when — and only when —
// the two captures agreed.
export const ansiRowsToText = (rows: readonly AnsiRow[]): string => rows.map(rowText).join("\n");

// The blank rows below the last line with real content — the unused part of the visible pane,
// not output — dropped the same way terminalScreen.ts's withoutTrailingBlanks drops them from
// the plain-text screen, so the styled and plain views end at the same line.
export const trimTrailingBlankAnsiRows = (rows: readonly AnsiRow[]): AnsiRow[] => rows.slice(0, rows.findLastIndex((row) => rowText(row).trim() !== "") + 1);

// Newline, counted alongside each row so the cap measures roughly the size of the JSON the
// phone receives — mirrors terminalScreen.ts's own ROW_SEPARATOR_BYTES accounting for the
// plain-text screen.
const ROW_SEPARATOR_BYTES = 1;

// The newest rows that fit in SCREEN_MAX_BYTES, scanned from the bottom exactly like
// terminalScreen.ts's own withinByteCap (not reused directly: that one is scoped to
// ScreenRow[], private to the plain mobile screen shape, and this shape carries segments instead of
// one text field) — kept as the SAME algorithm over the SAME budget, not a smaller version of
// it, so a local response can't grow unboundedly on a wide pane just because it is not
// constrained by the same byte ceiling (#7 round-2 review).
//
// Measures the SERIALIZED row (JSON.stringify), not just its visible text (#7 round-3 review):
// output that changes style every character (an extreme case, but not an impossible one) turns
// every character into its own `{text, fg, bg, bold}` object, whose JSON overhead dwarfs the
// one-byte-per-character the visible text alone would suggest — measuring text bytes only would
// let exactly that case defeat the cap this exists to enforce.
const withinAnsiByteCap = (rows: readonly AnsiRow[]): AnsiRow[] =>
  rows.reduceRight<{ kept: AnsiRow[]; bytes: number; full: boolean }>(
    (state, row) => {
      if (state.full) return state;
      const bytes = state.bytes + Buffer.byteLength(JSON.stringify(row), "utf8") + ROW_SEPARATOR_BYTES;
      if (bytes > SCREEN_MAX_BYTES) return { ...state, full: true };
      return { kept: [row, ...state.kept], bytes, full: false };
    },
    { kept: [], bytes: 0, full: false },
  ).kept;

// The full windowing rule for the styled screen, applied identically regardless of which
// capture path produced `rows` (tmux-text or the headless-buffer fallback) — the same trim,
// row cap and byte cap terminalScreen.ts's own screenWindow applies to the plain-text screen,
// so the two never disagree on how much of the pane is shown.
export const ansiScreenWindow = (rows: readonly AnsiRow[]): AnsiRow[] => withinAnsiByteCap(trimTrailingBlankAnsiRows(rows).slice(-SCREEN_HISTORY_ROWS));
