import { describe, it, expect } from "vitest";
import { computeFilePathLinks, rawFileUrl, fileViewerRoute, type TerminalCell } from "../../src/composables/terminalFilePathLinkProvider";

// Build a row of terminal cells from a string. Chars in WIDE occupy two columns (a
// width-2 cell + a width-0 continuation cell), as xterm stores CJK / emoji glyphs.
const WIDE = new Set(["あ", "を", "添", "付", "（", "）", "📎"]);
function toCells(s: string): TerminalCell[] {
  const cells: TerminalCell[] = [];
  for (const ch of s) {
    const width = WIDE.has(ch) ? 2 : 1;
    cells.push({ chars: ch, width });
    if (width === 2) cells.push({ chars: "", width: 0 });
  }
  return cells;
}

describe("computeFilePathLinks", () => {
  it("maps an ASCII path to 1-based inclusive columns", () => {
    const links = computeFilePathLinks(toCells("dir/x.png"));
    expect(links).toEqual([{ text: "dir/x.png", startX: 1, endX: 9 }]);
  });

  it("shifts columns past a preceding wide (CJK) glyph", () => {
    // "あ" occupies columns 1-2, so "dir/x.png" starts at column 4.
    const links = computeFilePathLinks(toCells("あ dir/x.png"));
    expect(links).toEqual([{ text: "dir/x.png", startX: 4, endX: 12 }]);
  });

  it("maps the issue's example path after wide glyphs and a full-width paren", () => {
    const [link] = computeFilePathLinks(toCells("📎 添付（dir/a.gif）"));
    expect(link.text).toBe("dir/a.gif");
    // 📎(1-2) space(3) 添(4-5) 付(6-7) （(8-9) d(10)…  → starts at column 10.
    expect(link.startX).toBe(10);
    expect(link.endX).toBe(18); // "dir/a.gif" is 9 cells: columns 10-18
  });

  it("returns nothing for a path-free row", () => {
    expect(computeFilePathLinks(toCells("no path here"))).toEqual([]);
  });
});

describe("rawFileUrl", () => {
  it("builds a cwd-scoped raw-file URL with both params encoded", () => {
    expect(rawFileUrl("assets/a b.gif", "/Users/me/proj")).toBe("/api/files/raw?cwd=%2FUsers%2Fme%2Fproj&path=assets%2Fa%20b.gif");
  });

  // A doc is for reading: the raw route serves .md as text/plain, so clicking one used to
  // open the source (#808). Same query shape, so only the route changes.
  it("sends markdown to the rendering route, keeping the same params", () => {
    expect(rawFileUrl("docs/terminal notes.md", "/Users/me/proj")).toBe("/api/files/browse/md?cwd=%2FUsers%2Fme%2Fproj&path=docs%2Fterminal%20notes.md");
  });
});

describe("fileViewerRoute", () => {
  it.each([".md", ".markdown"])("renders %s", (ext) => {
    expect(fileViewerRoute(`docs/notes${ext}`)).toBe("/api/files/browse/md");
  });

  it("matches the extension case-insensitively — README.MD is still markdown", () => {
    expect(fileViewerRoute("README.MD")).toBe("/api/files/browse/md");
    expect(fileViewerRoute("Notes.Markdown")).toBe("/api/files/browse/md");
  });

  // Everything the raw route already serves well — images, PDFs, source files as text — must
  // keep going there. Only a file we can present BETTER gets a different route.
  it.each(["a.png", "a.pdf", "a.ts", "a.txt", "a.json", "a.svg", "a.html"])("leaves %s on the raw route", (file) => {
    expect(fileViewerRoute(file)).toBe("/api/files/raw");
  });

  it("does not treat a mid-name .md or a dotfile as an extension", () => {
    expect(fileViewerRoute("notes.md.bak")).toBe("/api/files/raw");
    expect(fileViewerRoute("archive.md.gz")).toBe("/api/files/raw");
    expect(fileViewerRoute(".mdrc")).toBe("/api/files/raw");
  });

  it("leaves an extensionless file alone", () => {
    expect(fileViewerRoute("Makefile")).toBe("/api/files/raw");
    expect(fileViewerRoute("docs/README")).toBe("/api/files/raw");
  });
});
