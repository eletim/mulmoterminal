/* eslint-disable @typescript-eslint/consistent-type-assertions -- This file is the deliberate, version-pinned xterm internal API boundary. */
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { Terminal } from "@xterm/xterm";
import type { BrowserTerminalViewport } from "../../common/terminalViewport";
import { viewportRenderData } from "./terminalViewportScroll";

interface InternalCell {
  getChars(): string;
  getWidth(): number;
  getFgColor(): number;
  getBgColor(): number;
  isBold(): number;
  isItalic(): number;
  isUnderline(): number;
  isInverse(): number;
  hasExtendedAttrs(): number;
  extended: {
    urlId: number;
    clone(): InternalCell["extended"];
  };
}

export interface ParsedTerminalLinkData {
  id?: string;
  uri: string;
}

interface InternalOscLinkService {
  getLinkData(linkId: number): ParsedTerminalLinkData | undefined;
  registerLink(data: ParsedTerminalLinkData): number;
}

interface InternalLine {
  readonly length: number;
  isWrapped: boolean;
  loadCell(column: number, cell: InternalCell): InternalCell;
  setCell(column: number, cell: InternalCell): void;
  translateToString(trimRight?: boolean): string;
}

interface InternalList {
  length: number;
  maxLength: number;
  get(index: number): InternalLine | undefined;
  splice(start: number, deleteCount: number, ...items: InternalLine[]): void;
}

interface InternalBuffer {
  lines: InternalList;
  x: number;
  y: number;
  ybase: number;
  ydisp: number;
  getNullCell(): InternalCell;
  getBlankLine(cell: InternalCell, isWrapped?: boolean): InternalLine;
}

interface InternalTerminalCore {
  _bufferService: { buffer: InternalBuffer; isUserScrolling: boolean };
  _inputHandler: { parse(data: string): Promise<boolean> | undefined };
  _oscLinkService: InternalOscLinkService;
  _viewport?: { queueSync(ydisp?: number): void };
}

interface TerminalWithInternals extends Terminal {
  _core?: InternalTerminalCore;
  __installParsedViewportForTest?: (lines: readonly ParsedTerminalLine[], start: number) => void;
}

interface HeadlessWithInternals extends HeadlessTerminal {
  _core: InternalTerminalCore;
}

/** Opaque xterm BufferLine owned by one viewer and cloned from a one-shot headless parse. */
export interface ParsedTerminalLine {
  readonly line: InternalLine;
  readonly links: readonly ParsedTerminalLink[];
}

interface ParsedTerminalLink {
  readonly start: number;
  readonly end: number;
  readonly data: ParsedTerminalLinkData;
}

export interface ParsedTerminalSnapshot {
  readonly rows: readonly ParsedTerminalLine[];
  readonly cursorX: number;
  readonly cursorY: number;
  readonly restore: string;
}

export interface ParsedViewportMetrics {
  ansiParseCount: number;
  parsedChunkCount: number;
  snapshotWriteCount: number;
  viewportUpdateCount: number;
}

export interface ParsedTerminalCellSnapshot {
  chars: string;
  width: number;
  foreground: number;
  background: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

function coreOf(term: Terminal): InternalTerminalCore | null {
  return (term as TerminalWithInternals)._core ?? null;
}

function recordLink(links: ParsedTerminalLink[], column: number, data: ParsedTerminalLinkData): void {
  const previous = links.at(-1);
  if (previous?.data === data && previous.end === column) {
    links[links.length - 1] = { start: previous.start, end: column + 1, data };
  } else {
    links.push({ start: column, end: column + 1, data });
  }
}

function copyLine(source: InternalLine, sourceLinks: InternalOscLinkService, targetBuffer: InternalBuffer): ParsedTerminalLine {
  const cell = targetBuffer.getNullCell();
  const target = targetBuffer.getBlankLine(cell, source.isWrapped);
  const links: ParsedTerminalLink[] = [];
  for (let column = 0; column < Math.min(source.length, target.length); column++) {
    source.loadCell(column, cell);
    const sourceUrlId = cell.hasExtendedAttrs() ? cell.extended.urlId : 0;
    if (sourceUrlId) {
      const data = sourceLinks.getLinkData(sourceUrlId);
      if (data) recordLink(links, column, data);
      cell.extended = cell.extended.clone();
      cell.extended.urlId = 0;
    }
    target.setCell(column, cell);
  }
  return { line: target, links };
}

function installHyperlinks(buffer: InternalBuffer, service: InternalOscLinkService, lines: readonly ParsedTerminalLine[]): void {
  const savedBase = buffer.ybase;
  const savedY = buffer.y;
  const cell = buffer.getNullCell();
  for (let row = 0; row < lines.length; row++) {
    const parsed = lines[row];
    if (!parsed) continue;
    for (const link of parsed.links) {
      // OscLinkService registers its cleanup marker at the current absolute cursor row.
      buffer.ybase = row;
      buffer.y = 0;
      const urlId = service.registerLink(link.data);
      for (let column = link.start; column < link.end; column++) {
        parsed.line.loadCell(column, cell);
        cell.extended = cell.extended.clone();
        cell.extended.urlId = urlId;
        parsed.line.setCell(column, cell);
      }
    }
  }
  buffer.ybase = savedBase;
  buffer.y = savedY;
}

function parseSynchronously(core: InternalTerminalCore, data: string): void {
  const pending = core._inputHandler.parse(data);
  if (pending) throw new Error("xterm viewport parser unexpectedly paused on an asynchronous handler");
}

/**
 * The only MulmoTerminal boundary that knows xterm 6.0.0 internals. ANSI is parsed in a fresh
 * headless xterm once per Core chunk; normal wheel movement only changes ydisp and refreshes.
 */
export class TerminalParsedBufferAdapter {
  readonly metrics: ParsedViewportMetrics = {
    ansiParseCount: 0,
    parsedChunkCount: 0,
    snapshotWriteCount: 0,
    viewportUpdateCount: 0,
  };
  private installedLines: readonly ParsedTerminalLine[] = [];
  private readonly term: Terminal;

  constructor(term: Terminal) {
    this.term = term;
  }

  parse(viewport: BrowserTerminalViewport): ParsedTerminalSnapshot {
    const parser = new HeadlessTerminal({ cols: viewport.cols, rows: viewport.viewportRows, scrollback: 0 }) as HeadlessWithInternals;
    parseSynchronously(parser._core, viewportRenderData(viewport.content, viewport.restore));
    const source = parser._core._bufferService.buffer;
    const target = coreOf(this.term)?._bufferService.buffer;
    const rows: ParsedTerminalLine[] = [];
    for (let row = 0; row < viewport.viewportRows; row++) {
      const line = source.lines.get(source.ydisp + row);
      if (line) rows.push(copyLine(line, parser._core._oscLinkService, target ?? source));
    }
    const snapshot = { rows, cursorX: source.x, cursorY: source.y, restore: viewport.restore ?? "" };
    this.metrics.ansiParseCount++;
    this.metrics.parsedChunkCount++;
    parser.dispose();
    return snapshot;
  }

  install(lines: readonly ParsedTerminalLine[], start: number, cursor: { x: number; y: number; restore: string }): void {
    const testTerminal = this.term as TerminalWithInternals;
    if (testTerminal.__installParsedViewportForTest) {
      testTerminal.__installParsedViewportForTest(lines, start);
      this.installedLines = lines;
      this.metrics.viewportUpdateCount++;
      return;
    }
    const core = coreOf(this.term);
    if (!core) throw new Error("xterm 6.0.0 parsed-buffer internals unavailable");
    if (cursor.restore) parseSynchronously(core, cursor.restore);
    const buffer = core._bufferService.buffer;
    const selection = this.term.getSelectionPosition();
    const selectedEndIndex = selection && selection.end.x === 0 && selection.end.y > selection.start.y ? selection.end.y - 1 : selection?.end.y;
    const selectedStartLine = selection ? this.installedLines[selection.start.y] : undefined;
    const selectedEndLine = selectedEndIndex === undefined ? undefined : this.installedLines[selectedEndIndex];
    buffer.lines.maxLength = Math.max(buffer.lines.maxLength, lines.length);
    buffer.lines.splice(0, buffer.lines.length, ...lines.map((row) => row.line));
    installHyperlinks(buffer, core._oscLinkService, lines);
    buffer.ybase = Math.max(0, lines.length - this.term.rows);
    buffer.ydisp = Math.max(0, Math.min(start, buffer.ybase));
    core._bufferService.isUserScrolling = buffer.ydisp < buffer.ybase;
    buffer.x = Math.max(0, Math.min(cursor.x, this.term.cols - 1));
    buffer.y = Math.max(0, Math.min(cursor.y, this.term.rows - 1));
    this.restoreSelection(selection, selectedStartLine, selectedEndLine, selectedEndIndex, lines);
    this.installedLines = lines;
    core._viewport?.queueSync(buffer.ydisp);
    this.term.refresh(0, this.term.rows - 1);
    this.metrics.viewportUpdateCount++;
  }

  setViewport(start: number): void {
    (this.term as TerminalWithInternals).__installParsedViewportForTest?.(this.installedLines, start);
    this.term.scrollToLine(start);
    this.metrics.viewportUpdateCount++;
  }

  reset(): void {
    this.installedLines = [];
  }

  inspectCell(row: ParsedTerminalLine, column: number): ParsedTerminalCellSnapshot {
    const core = coreOf(this.term);
    const cell = core?._bufferService.buffer.getNullCell();
    if (!cell) throw new Error("xterm cell internals unavailable");
    const value = row.line.loadCell(column, cell);
    return {
      chars: value.getChars(),
      width: value.getWidth(),
      foreground: value.getFgColor(),
      background: value.getBgColor(),
      bold: !!value.isBold(),
      italic: !!value.isItalic(),
      underline: !!value.isUnderline(),
      inverse: !!value.isInverse(),
    };
  }

  inspectLink(row: ParsedTerminalLine, column: number): ParsedTerminalLinkData | undefined {
    const core = coreOf(this.term);
    const cell = core?._bufferService.buffer.getNullCell();
    if (!core || !cell) throw new Error("xterm link internals unavailable");
    const value = row.line.loadCell(column, cell);
    return core._oscLinkService.getLinkData(value.extended.urlId);
  }

  inspectUserScrolling(): boolean {
    const core = coreOf(this.term);
    if (!core) throw new Error("xterm buffer-service internals unavailable");
    return core._bufferService.isUserScrolling;
  }

  private restoreSelection(
    selection: ReturnType<Terminal["getSelectionPosition"]>,
    selectedStartLine: ParsedTerminalLine | undefined,
    selectedEndLine: ParsedTerminalLine | undefined,
    selectedEndIndex: number | undefined,
    lines: readonly ParsedTerminalLine[],
  ): void {
    if (!selection) return;
    if (!selectedStartLine || !selectedEndLine || selectedEndIndex === undefined) {
      this.term.clearSelection();
      return;
    }
    const startRow = lines.indexOf(selectedStartLine);
    const endRow = lines.indexOf(selectedEndLine);
    if (startRow < 0 || endRow - startRow !== selectedEndIndex - selection.start.y) {
      this.term.clearSelection();
      return;
    }
    const length = (selection.end.y - selection.start.y) * this.term.cols - selection.start.x + selection.end.x;
    this.term.select(selection.start.x, startRow, length);
  }
}
