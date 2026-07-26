import { describe, it, expect } from "vitest";
import {
  normalizeFontFamily,
  TERMINAL_FONT_FAMILY_DEFAULT,
  TERMINAL_FONT_FAMILY_MAX_CHARS,
  TERMINAL_FONT_FAMILY_SAFE_RE,
} from "../../common/terminalFontFamily";

describe("normalizeFontFamily", () => {
  it("keeps a stack of plain, quoted, and generic names", () => {
    expect(normalizeFontFamily("Menlo, monospace")).toBe("Menlo, monospace");
    expect(normalizeFontFamily("'JetBrains Mono', 'Fira Code', monospace")).toBe("'JetBrains Mono', 'Fira Code', monospace");
    expect(normalizeFontFamily('"MS Gothic", monospace')).toBe('"MS Gothic", monospace');
    expect(normalizeFontFamily("ui-monospace")).toBe("ui-monospace");
  });

  // Font names are not ASCII. A Japanese user naming the font as it appears in their font book
  // must not be told their config is invalid.
  it("accepts font names in any script", () => {
    expect(normalizeFontFamily("'游ゴシック', monospace")).toBe("'游ゴシック', monospace");
    expect(normalizeFontFamily("ＭＳ ゴシック, monospace")).toBe("ＭＳ ゴシック, monospace");
    expect(normalizeFontFamily("'나눔고딕코딩', monospace")).toBe("'나눔고딕코딩', monospace");
  });

  it("normalizes the spacing around separators", () => {
    expect(normalizeFontFamily("  Menlo,Consolas ,  monospace  ")).toBe("Menlo, Consolas, monospace");
  });

  // A stack whose fonts are all missing falls through to the browser's default, which is
  // PROPORTIONAL — every column misaligned, with nothing on screen to explain why.
  it("appends monospace when the author named no generic family", () => {
    expect(normalizeFontFamily("Cica")).toBe("Cica, monospace");
    expect(normalizeFontFamily("'HackGen Console', Menlo")).toBe("'HackGen Console', Menlo, monospace");
  });

  it("leaves a stack that already names a generic family alone", () => {
    expect(normalizeFontFamily("Cica, monospace")).toBe("Cica, monospace");
    expect(normalizeFontFamily("'Menlo', 'monospace'")).toBe("'Menlo', 'monospace'");
    // An author who deliberately asked for a proportional tail keeps it — we don't second-guess it.
    expect(normalizeFontFamily("Cica, sans-serif")).toBe("Cica, sans-serif");
  });

  // Rejected whole, where normalizeFontSize clamps: a stack is one intent, so keeping the half
  // that parsed would render in a font the author never named.
  it("rejects the whole stack when any entry is unusable", () => {
    expect(normalizeFontFamily("Menlo, (bad), monospace")).toBeNull();
    expect(normalizeFontFamily("Menlo, , monospace")).toBeNull();
  });

  // The value reaches a CSS declaration. A `;` or a brace at best invalidates the whole
  // declaration — which xterm reports by rendering in the browser's proportional default, i.e.
  // the setting reads as having broken the terminal.
  it("rejects CSS syntax", () => {
    expect(normalizeFontFamily("Menlo; color: red")).toBeNull();
    expect(normalizeFontFamily("Menlo } body {")).toBeNull();
    expect(normalizeFontFamily("url(evil.css)")).toBeNull();
    expect(normalizeFontFamily("@import 'x'")).toBeNull();
    expect(normalizeFontFamily("<script>")).toBeNull();
  });

  // A stray quote unbalances the declaration, so it is rejected rather than passed through.
  it("requires quotes to be a matching pair around a whole entry", () => {
    expect(normalizeFontFamily("'Menlo")).toBeNull();
    expect(normalizeFontFamily("Menlo'")).toBeNull();
    expect(normalizeFontFamily("'Menlo\"")).toBeNull();
    expect(normalizeFontFamily("Men'lo")).toBeNull();
    expect(normalizeFontFamily("''")).toBeNull();
  });

  it("rejects control characters", () => {
    expect(normalizeFontFamily("Men\nlo")).toBeNull();
    expect(normalizeFontFamily("Men\tlo")).toBeNull();
    expect(normalizeFontFamily("Menlo\u0000")).toBeNull();
  });

  it("returns null for a blank or non-string value", () => {
    expect(normalizeFontFamily("")).toBeNull();
    expect(normalizeFontFamily("   ")).toBeNull();
    expect(normalizeFontFamily(",")).toBeNull();
    expect(normalizeFontFamily(null)).toBeNull();
    expect(normalizeFontFamily(undefined)).toBeNull();
    expect(normalizeFontFamily(14)).toBeNull();
    expect(normalizeFontFamily(["Menlo"])).toBeNull();
    expect(normalizeFontFamily({ family: "Menlo" })).toBeNull();
  });

  it("rejects a stack past the length cap", () => {
    const long = `${"A".repeat(TERMINAL_FONT_FAMILY_MAX_CHARS)}, monospace`;
    expect(normalizeFontFamily(long)).toBeNull();
    expect(normalizeFontFamily("A".repeat(TERMINAL_FONT_FAMILY_MAX_CHARS))).toBe(`${"A".repeat(TERMINAL_FONT_FAMILY_MAX_CHARS)}, monospace`);
  });

  it("accepts its own default unchanged", () => {
    expect(normalizeFontFamily(TERMINAL_FONT_FAMILY_DEFAULT)).toBe(TERMINAL_FONT_FAMILY_DEFAULT);
  });

  // The shipped JSON Schema can only carry the portable pattern (no \p{L} without the `u` flag),
  // so it is a SUBSET check. It must never reject something the real rule accepts, or the config
  // skill would refuse a valid font stack that the server would have loaded happily.
  it("only accepts stacks the JSON Schema's portable pattern also accepts", () => {
    const accepted = [
      TERMINAL_FONT_FAMILY_DEFAULT,
      "Menlo, monospace",
      "'JetBrains Mono', 'Fira Code', monospace",
      '"MS Gothic", monospace',
      "'游ゴシック', monospace",
      "ＭＳ ゴシック, monospace",
      "Cica",
    ];
    accepted.forEach((stack) => {
      expect(normalizeFontFamily(stack)).not.toBeNull();
      expect(TERMINAL_FONT_FAMILY_SAFE_RE.test(stack)).toBe(true);
    });
  });
});
