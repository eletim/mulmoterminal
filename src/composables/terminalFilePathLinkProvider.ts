// Turns file paths in xterm terminal output into clickable links that open the file in a
// new browser tab (via the raw-file route, scoped to the session's cwd). Registered next
// to WebLinksAddon, which handles http/https URLs.
//
// The pure core (computeFilePathLinks) maps a row of terminal cells to link ranges in
// 1-based inclusive columns — accounting for wide (CJK) glyphs that occupy two columns —
// so the string ranges from findFilePathLinks land on the right cells.
import type { Terminal, ILinkProvider, ILink } from "@xterm/xterm";
import { findFilePathLinks } from "./terminalFilePathLinks";

export interface TerminalCell {
  chars: string;
  width: number;
}

export interface ColumnLink {
  text: string;
  startX: number; // 1-based, inclusive
  endX: number; // 1-based, inclusive
}

// Wide glyphs occupy two columns (a width-2 cell followed by a width-0 continuation cell);
// map every UTF-16 unit to the column it starts and ends in, then linkify the joined text.
export function computeFilePathLinks(cells: TerminalCell[]): ColumnLink[] {
  const units: string[] = [];
  const colStart: number[] = [];
  const colEnd: number[] = [];
  for (let col = 0; col < cells.length; col++) {
    const cell = cells[col];
    if (cell.width === 0) continue; // trailing half of the preceding wide glyph
    const chars = cell.chars.length ? cell.chars : " "; // an unwritten cell renders as a space
    for (let k = 0; k < chars.length; k++) {
      units.push(chars[k]);
      colStart.push(col);
      colEnd.push(col + cell.width - 1);
    }
  }
  return findFilePathLinks(units.join("")).map((hit) => ({
    text: hit.text,
    startX: colStart[hit.start] + 1,
    endX: colEnd[hit.end - 1] + 1,
  }));
}

// Which route opens a clicked path, by extension. A file the browser can only show as
// SOURCE goes to the raw route; one we can present better gets its own. Kept as a table so
// the next extension is a row rather than a branch (#808).
//
// The markdown route is what the Files overlay already previews with — same `cwd`/`path`
// query, marked-rendered, served under a sandbox CSP. It resolves its base slightly more
// loosely than the raw route (any existing absolute dir, vs. the raw route's "root or a live
// session cwd"), which is the browse routes' documented posture; the cwd handed over here is
// the session's own either way.
const ROUTE_BY_EXTENSION: Record<string, string> = {
  ".md": "/api/files/browse/md",
  ".markdown": "/api/files/browse/md",
  ".json": "/api/files/browse/json",
  ".csv": "/api/files/browse/table",
  ".tsv": "/api/files/browse/table",
};

const RAW_ROUTE = "/api/files/raw";

// Source: nothing a browser tab can do with it beyond showing the bytes, which is what the
// app's own Files view does better — CodeMirror highlights it, the tree is right there, and
// it can be edited (#808). Kept to what a terminal actually prints paths to; the list can
// grow the same way ROUTE_BY_EXTENSION does.
const IN_APP_EXTENSIONS = new Set<string>([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".astro",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".hpp",
  ".cs",
  ".php",
  ".swift",
  ".scala",
  ".lua",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".xml",
  ".jsonc",
  ".txt",
  ".log",
  ".diff",
  ".patch",
]);

/** How a clicked path opens: in the app's own Files view, or at a URL in a new tab. */
export type FileLinkTarget = { kind: "files" } | { kind: "url"; url: string };

/** A path's extension, lower-cased — `README.MD` is still markdown, and a `.md` in the
 *  middle of a name is not an extension. Empty when there is none. */
export function fileExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot === -1 ? "" : filePath.slice(dot).toLowerCase();
}

/** The route a path's extension is opened through. */
export function fileViewerRoute(filePath: string): string {
  return ROUTE_BY_EXTENSION[fileExtension(filePath)] ?? RAW_ROUTE;
}

export function fileLinkTarget(filePath: string, cwd: string): FileLinkTarget {
  if (IN_APP_EXTENSIONS.has(fileExtension(filePath))) return { kind: "files" };
  return { kind: "url", url: rawFileUrl(filePath, cwd) };
}

export function rawFileUrl(filePath: string, cwd: string): string {
  return `${fileViewerRoute(filePath)}?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(filePath)}`;
}

function readCells(term: Terminal, bufferLineNumber: number): TerminalCell[] | null {
  const line = term.buffer.active.getLine(bufferLineNumber - 1);
  if (!line) return null;
  const cells: TerminalCell[] = [];
  for (let i = 0; i < line.length; i++) {
    const cell = line.getCell(i);
    cells.push({ chars: cell?.getChars() ?? "", width: cell?.getWidth() ?? 1 });
  }
  return cells;
}

export function createFilePathLinkProvider(
  term: Terminal,
  getCwd: () => string | null,
  openUrl: (url: string) => void,
  openInFiles: (filePath: string, cwd: string) => void,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
      const cwd = getCwd();
      const cells = cwd ? readCells(term, bufferLineNumber) : null;
      if (!cwd || !cells) return callback(undefined);
      const links: ILink[] = computeFilePathLinks(cells).map((link) => ({
        text: link.text,
        range: { start: { x: link.startX, y: bufferLineNumber }, end: { x: link.endX, y: bufferLineNumber } },
        decorations: { pointerCursor: true, underline: true },
        activate: () => {
          const target = fileLinkTarget(link.text, cwd);
          if (target.kind === "files") openInFiles(link.text, cwd);
          else openUrl(target.url);
        },
      }));
      callback(links.length ? links : undefined);
    },
  };
}
