// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { renderScreen, renderAnsiRows, type HeadlessScreenInput } from "../../../server/session/headlessScreen.js";
import { rowsToScreen } from "../../../server/session/screen-rows.js";
import { resolveIndexColor } from "../../../server/session/ansiSegments.js";

const ESC = String.fromCharCode(0x1b);

// renderScreen returns rows carrying each line's dim run alongside its text (#563);
// everything below this helper is about the text. historyLines defaults to none, so each
// case says whether it is about the visible pane or about the scrollback above it.
const screenOf = async (input: Omit<HeadlessScreenInput, "historyLines"> & { historyLines?: number }): Promise<string> =>
  rowsToScreen(await renderScreen({ historyLines: 0, ...input })).trimEnd();

// @xterm/headless ships a UMD/CJS bundle whose `module` field points at a path that does
// not exist, so Node's ESM loader falls back to CJS and cannot see the named export. A
// bare `import { Terminal }` throws at STARTUP under `node --import tsx` — and this suite
// would never notice, because vitest resolves the package differently. Hence a source
// assertion rather than a behavioural one.
describe("headlessScreen module shape", () => {
  it("imports the emulator as a default, which is what real Node ESM can resolve", () => {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../server/session/headlessScreen.ts"), "utf-8");
    expect(source).toMatch(/import headless from "@xterm\/headless"/);
    expect(source).not.toMatch(/import \{[^}]*Terminal[^}]*\} from "@xterm\/headless"/);
  });
});

describe("renderScreen", () => {
  // The whole point: a byte stream is not a screen until an emulator has run it.
  it("renders the screen a stream would produce, not the stream", async () => {
    const buffer = `${ESC}[31mRED${ESC}[0m plain\r\nsecond`;
    expect(await screenOf({ buffer, cols: 40, rows: 5 })).toBe("RED plain\nsecond");
  });

  // Reading buffer.active before term.write's callback yields an empty screen — the
  // regression this asserts against is a silent one (blank screens, no error).
  it("waits for the parser instead of returning a blank screen", async () => {
    expect(await screenOf({ buffer: "content", cols: 20, rows: 3 })).toBe("content");
  });

  it("honours cursor addressing rather than replaying in write order", async () => {
    // Write "second" on row 2, then jump back to row 1 and write "first".
    const buffer = `${ESC}[2;1Hsecond${ESC}[1;1Hfirst`;
    expect(await screenOf({ buffer, cols: 20, rows: 4 })).toBe("first\nsecond");
  });

  it("applies an erase-screen so stale content does not survive", async () => {
    const buffer = `garbage${ESC}[2J${ESC}[1;1Hclean`;
    expect(await screenOf({ buffer, cols: 20, rows: 3 })).toBe("clean");
  });

  it("returns the CURRENT screen once output has scrolled past the viewport", async () => {
    const buffer = Array.from({ length: 12 }, (_, i) => `line${i}`).join("\r\n");
    // rows: 4 → only the last four lines are on screen.
    expect(await screenOf({ buffer, cols: 20, rows: 4 })).toBe("line8\nline9\nline10\nline11");
  });

  // What the phone actually reads: one pane's worth is too little on a small screen, so the
  // window reaches above the viewport — the same history `capture-pane -S -n` returns
  // (mulmoserver#139).
  it("reaches above the viewport for the scrollback the phone is shown", async () => {
    const buffer = Array.from({ length: 12 }, (_, i) => `line${i}`).join("\r\n");
    expect(await screenOf({ buffer, cols: 20, rows: 4, historyLines: 5 })).toBe(
      ["line3", "line4", "line5", "line6", "line7", "line8", "line9", "line10", "line11"].join("\n"),
    );
  });

  // A session younger than the window has less history, not an error — and asking for more
  // than the emulator ever held must not shift the window off the live rows.
  it("yields what history there is when the session is younger than the window", async () => {
    const buffer = Array.from({ length: 6 }, (_, i) => `line${i}`).join("\r\n");
    expect(await screenOf({ buffer, cols: 20, rows: 4, historyLines: 300 })).toBe(["line0", "line1", "line2", "line3", "line4", "line5"].join("\n"));
  });

  it("wraps at the configured width", async () => {
    expect(await screenOf({ buffer: "abcdef", cols: 3, rows: 4 })).toBe("abc\ndef");
  });

  it("handles an empty buffer", async () => {
    expect(await screenOf({ buffer: "", cols: 20, rows: 3 })).toBe("");
  });

  // A truncated tail can begin mid-sequence (#434 trims that, but a lone ESC at the very
  // end is still possible) — an unterminated sequence must not hang or throw.
  it("survives a buffer ending mid-sequence", async () => {
    expect(await screenOf({ buffer: `visible${ESC}[3`, cols: 20, rows: 3 })).toBe("visible");
  });

  // Dim is what tells an agent's ghost suggestion apart from text the user typed, so a
  // tmux-less host has to carry it out of the emulator too.
  it("reads the dim run off the cells", async () => {
    const rows = await renderScreen({ buffer: `❯ ${ESC}[2mwrite the tests${ESC}[0m`, cols: 40, rows: 2, historyLines: 0 });
    expect(rows[0]).toEqual({ text: "❯ write the tests", dim: "write the tests" });
  });

  it("leaves dim empty on a plain row", async () => {
    const rows = await renderScreen({ buffer: "❯ write the tests", cols: 40, rows: 2, historyLines: 0 });
    expect(rows[0]).toEqual({ text: "❯ write the tests", dim: "" });
  });
});

// The fallback capture route's colour layer (#7): the same emulator renderScreen already runs
// over the same buffer, read for the cells' resolved colour/bold instead of for dim. Reading
// the emulator's own resolved state (rather than re-parsing the escapes) means this is exact by
// construction — these cases exercise the merging into segments and the trims, not the SGR
// parsing itself (ansiSegments.spec.ts already covers that for the tmux-text route).
describe("renderAnsiRows", () => {
  const ansiRowsOf = async (input: Omit<HeadlessScreenInput, "historyLines"> & { historyLines?: number }) => renderAnsiRows({ historyLines: 0, ...input });

  it("renders a colourless buffer as one plain segment per row", async () => {
    const rows = await ansiRowsOf({ buffer: "plain text", cols: 20, rows: 2 });
    expect(rows).toEqual([[{ text: "plain text", fg: null, bg: null, bold: false }]]);
  });

  it("reads a foreground colour off the cells", async () => {
    const rows = await ansiRowsOf({ buffer: `${ESC}[31mred${ESC}[0m`, cols: 20, rows: 2 });
    expect(rows).toEqual([[{ text: "red", fg: "#e06c75", bg: null, bold: false }]]);
  });

  it("reads a background colour and bold off the cells", async () => {
    const rows = await ansiRowsOf({ buffer: `${ESC}[1;42mbold on green${ESC}[0m`, cols: 20, rows: 2 });
    expect(rows).toEqual([[{ text: "bold on green", fg: null, bg: "#98c379", bold: true }]]);
  });

  it("does not let style leak past a reset, even mid-row", async () => {
    const rows = await ansiRowsOf({ buffer: `${ESC}[31mred${ESC}[0m plain`, cols: 20, rows: 2 });
    expect(rows).toEqual([
      [
        { text: "red", fg: "#e06c75", bg: null, bold: false },
        { text: " plain", fg: null, bg: null, bold: false },
      ],
    ]);
  });

  it("resolves a 256-colour cell to the same colour ansiSegments.ts's table would", async () => {
    const rows = await ansiRowsOf({ buffer: `${ESC}[38;5;196mvivid`, cols: 20, rows: 2 });
    expect(rows[0]?.[0]?.fg).toBe(resolveIndexColor(196));
  });

  it("resolves a truecolor cell", async () => {
    const rows = await ansiRowsOf({ buffer: `${ESC}[38;2;10;20;30mtruecolor`, cols: 20, rows: 2 });
    expect(rows[0]?.[0]?.fg).toBe("#0a141e");
  });

  it("survives a buffer ending mid-sequence without throwing", async () => {
    await expect(ansiRowsOf({ buffer: `visible${ESC}[3`, cols: 20, rows: 2 })).resolves.toEqual([[{ text: "visible", fg: null, bg: null, bold: false }]]);
  });

  it("drops trailing blank rows below the last row with content", async () => {
    const rows = await ansiRowsOf({ buffer: "one line", cols: 20, rows: 5 });
    expect(rows).toHaveLength(1);
  });

  it("handles an empty buffer without throwing", async () => {
    await expect(ansiRowsOf({ buffer: "", cols: 20, rows: 3 })).resolves.toEqual([]);
  });
});
