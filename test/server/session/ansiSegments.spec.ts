// @vitest-environment node
import { describe, it, expect } from "vitest";

import { parseAnsiRow, parseAnsiRows, resolveIndexColor, trimTrailingBlankAnsiRows, trimTrailingPad } from "../../../server/session/ansiSegments.js";
import type { AnsiSegment } from "../../../common/ansiStyle.js";

const ESC = String.fromCharCode(0x1b);
const NBSP = String.fromCharCode(0xa0);

const plain = (text: string): AnsiSegment => ({ text, fg: null, bg: null, bold: false });

describe("parseAnsiRow", () => {
  it("leaves an unstyled row as one plain segment", () => {
    expect(parseAnsiRow("nothing styled here")).toEqual([plain("nothing styled here")]);
  });

  it("reads a standard foreground colour (#7's minimum: fg)", () => {
    expect(parseAnsiRow(`${ESC}[31mred text${ESC}[0m`)).toEqual([{ text: "red text", fg: "#e06c75", bg: null, bold: false }]);
  });

  it("reads a standard background colour (#7's minimum: bg)", () => {
    expect(parseAnsiRow(`${ESC}[42mgreen bg${ESC}[0m`)).toEqual([{ text: "green bg", fg: null, bg: "#98c379", bold: false }]);
  });

  it("reads bold (#7's minimum: bold)", () => {
    expect(parseAnsiRow(`${ESC}[1mbold${ESC}[0m`)).toEqual([{ text: "bold", fg: null, bg: null, bold: true }]);
  });

  it("combines fg, bg and bold from one SGR sequence", () => {
    expect(parseAnsiRow(`${ESC}[1;31;44mbold red on blue${ESC}[0m`)).toEqual([{ text: "bold red on blue", fg: "#e06c75", bg: "#61afef", bold: true }]);
  });

  it("does not leak style past an explicit reset (#7's minimum: reset)", () => {
    expect(parseAnsiRow(`${ESC}[31mred${ESC}[0m plain`)).toEqual([{ text: "red", fg: "#e06c75", bg: null, bold: false }, plain(" plain")]);
  });

  it("does not leak style past a bare reset (ESC[m, no digits)", () => {
    expect(parseAnsiRow(`${ESC}[31mred${ESC}[m plain`)).toEqual([{ text: "red", fg: "#e06c75", bg: null, bold: false }, plain(" plain")]);
  });

  it("clears just the foreground on code 39 without touching bold", () => {
    expect(parseAnsiRow(`${ESC}[1;31mbold red${ESC}[39m bold only`)).toEqual([
      { text: "bold red", fg: "#e06c75", bg: null, bold: true },
      { text: " bold only", fg: null, bg: null, bold: true },
    ]);
  });

  it("switches styles multiple times across one row", () => {
    expect(parseAnsiRow(`${ESC}[31mred${ESC}[32mgreen${ESC}[34mblue${ESC}[0mplain`)).toEqual([
      { text: "red", fg: "#e06c75", bg: null, bold: false },
      { text: "green", fg: "#98c379", bg: null, bold: false },
      { text: "blue", fg: "#61afef", bg: null, bold: false },
      plain("plain"),
    ]);
  });

  it("reads bright (90-97/100-107) colours", () => {
    expect(parseAnsiRow(`${ESC}[91;103mbright red on bright yellow`)).toEqual([
      { text: "bright red on bright yellow", fg: "#ef596f", bg: "#f0c674", bold: false },
    ]);
  });

  it("resolves a 256-colour foreground (kept when the parsing is reused, per #7)", () => {
    expect(parseAnsiRow(`${ESC}[38;5;196mvivid red`)).toEqual([{ text: "vivid red", fg: resolveIndexColor(196), bg: null, bold: false }]);
  });

  it("resolves a truecolor (24-bit) foreground", () => {
    expect(parseAnsiRow(`${ESC}[38;2;10;20;30mtruecolor`)).toEqual([{ text: "truecolor", fg: "#0a141e", bg: null, bold: false }]);
  });

  it("does not read an extended colour's own arguments as a later attribute (the 38;5;2 trap)", () => {
    // The trailing "2" belongs to "38;5;2" (green); it must not be read as SGR 2 (dim) or
    // consumed twice — screen-rows.spec.ts pins the identical trap for the dim scan.
    expect(parseAnsiRow(`${ESC}[38;5;2mgreen 38;5;2`)).toEqual([{ text: "green 38;5;2", fg: resolveIndexColor(2), bg: null, bold: false }]);
  });

  it("skips an underline-colour sequence (58) without letting its args desync later codes", () => {
    expect(parseAnsiRow(`${ESC}[58;5;9m${ESC}[31mred`)).toEqual([{ text: "red", fg: "#e06c75", bg: null, bold: false }]);
  });

  it("ignores an SGR code outside #7's scope (italic) without losing the colour beside it", () => {
    expect(parseAnsiRow(`${ESC}[3;31mitalic red`)).toEqual([{ text: "italic red", fg: "#e06c75", bg: null, bold: false }]);
  });

  // A known, documented limitation (see sgrOfEscape's own comment): the colon-separated
  // ITU-T.416 sub-parameter form is a single unsplit token here, so 38/48 never matches it.
  // `tmux capture-pane -e` — the only real producer of this text — has always used semicolons,
  // so this never occurs in practice; the case here is that it degrades safely (colour simply
  // not applied) rather than throwing or leaking the raw escape into the visible text.
  it("does not crash or leak raw escape bytes on a colon-separated (ITU-T.416) colour code", () => {
    expect(() => parseAnsiRow(`${ESC}[38:2::10:20:30mtext`)).not.toThrow();
    const row = parseAnsiRow(`${ESC}[38:2::10:20:30mtext`);
    expect(row.map((s) => s.text).join("")).toBe("text");
    expect(row.map((s) => s.text).join("")).not.toContain(ESC);
  });

  it("drops an OSC 8 hyperlink escape without exposing it as text", () => {
    const row = `${ESC}]8;id=1;https://example.com${ESC}\\link text${ESC}]8;;${ESC}\\`;
    expect(parseAnsiRow(row)).toEqual([plain("link text")]);
  });

  it("survives an incomplete/unterminated escape sequence without throwing or losing the row", () => {
    expect(() => parseAnsiRow(`visible${ESC}[31`)).not.toThrow();
    // The malformed tail is neither a colour code nor is it rendered as a raw escape byte in
    // the segment text handed to the browser — screen-rows.ts's own regex already drops what
    // it cannot parse, and this inherits that behaviour rather than reimplementing it.
    expect(
      parseAnsiRow(`visible${ESC}[31`)
        .map((s) => s.text)
        .join(""),
    ).not.toContain(ESC);
  });

  it("keeps a no-break space at the end of a row (Claude Code's empty input box)", () => {
    expect(parseAnsiRow(`${ESC}[38;5;241m❯${NBSP}${ESC}[39m`)).toEqual([{ text: `❯${NBSP}`, fg: resolveIndexColor(241), bg: null, bold: false }]);
  });

  it("trims a trailing run of plain ASCII spaces (the -e padding -p never had)", () => {
    expect(parseAnsiRow(`${ESC}[48;5;236mRan 2 shell commands   ${ESC}[49m`)).toEqual([
      { text: "Ran 2 shell commands", fg: null, bg: resolveIndexColor(236), bold: false },
    ]);
  });

  it("renders plain text with no ANSI at all as a single colourless segment", () => {
    expect(parseAnsiRow("just plain text, no codes")).toEqual([plain("just plain text, no codes")]);
  });

  it("keeps an HTML/script-looking string as inert text data, never markup", () => {
    // This is a data-shape guarantee: the caller never puts this string anywhere but a text
    // node (see MobileTerminalPage.vue's {{ }} interpolation), but the segment itself must
    // still carry the string byte for byte rather than something already "sanitized" oddly.
    expect(parseAnsiRow(`${ESC}[31m<script>alert(1)</script>${ESC}[0m`)).toEqual([{ text: "<script>alert(1)</script>", fg: "#e06c75", bg: null, bold: false }]);
  });
});

describe("parseAnsiRows", () => {
  it("resets style at the start of every row (tmux emits each row self-contained)", () => {
    const rows = parseAnsiRows([`${ESC}[31mred`, "plain second row"].join("\n"));
    expect(rows).toEqual([[{ text: "red", fg: "#e06c75", bg: null, bold: false }], [plain("plain second row")]]);
  });

  it("keeps line breaks: one AnsiRow per input line, including blank ones", () => {
    expect(parseAnsiRows("a\n\nb")).toEqual([[plain("a")], [], [plain("b")]]);
  });
});

describe("trimTrailingPad", () => {
  it("drops a fully-blank trailing segment entirely", () => {
    expect(trimTrailingPad([plain("text"), { text: "   ", fg: "#e06c75", bg: null, bold: false }])).toEqual([plain("text")]);
  });

  it("leaves a segment with real trailing content untouched", () => {
    expect(trimTrailingPad([plain("text")])).toEqual([plain("text")]);
  });
});

describe("trimTrailingBlankAnsiRows", () => {
  it("drops trailing rows with no visible text, keeping earlier blank rows", () => {
    const rows = [[plain("a")], [], [plain("b")], [], []];
    expect(trimTrailingBlankAnsiRows(rows)).toEqual([[plain("a")], [], [plain("b")]]);
  });
});
