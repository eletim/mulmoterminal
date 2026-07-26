// @vitest-environment node
//
// Two jobs. First, that the probe recognises the upstream corruption (xtermjs/xterm.js#6063) —
// pinned against the real numbers from that issue's flight recorder, not invented ones. Second,
// and more important: that it NEVER fires on a healthy terminal. A false positive rebuilds a live
// terminal and costs the user their client-side scrollback, so the negative case is driven
// against a real xterm through the operation mix a live slot actually sees.
import { describe, it, expect } from "vitest";
import { Terminal } from "@xterm/headless";
import { bufferIsShort, readBufferShape } from "../../../src/composables/terminalBufferHealth";

const write = (term: Terminal, data: string) => new Promise<void>((resolve) => term.write(data, resolve));

describe("bufferIsShort", () => {
  it("passes a healthy buffer", () => {
    expect(bufferIsShort({ length: 23, baseY: 5, cursorY: 13, rows: 18 })).toBe(false);
  });

  // The masked state upstream recorded before the fatal fit: 39x18 with ybase=5, y=13, and a
  // logical length already below ybase + rows. Stale CircularList slots hid it from xterm.
  it("catches the upstream state before the resize that makes it fatal", () => {
    expect(bufferIsShort({ length: 18, baseY: 5, cursorY: 13, rows: 18 })).toBe(true);
  });

  // ...and the end state after that resize, where viewport rows 18-22 have no line at all.
  it("catches the upstream state after the resize", () => {
    expect(bufferIsShort({ length: 18, baseY: 0, cursorY: 18, rows: 23 })).toBe(true);
  });

  it("accepts a buffer that exactly covers the viewport", () => {
    expect(bufferIsShort({ length: 24, baseY: 0, cursorY: 23, rows: 24 })).toBe(false);
  });

  it("catches a buffer one line short of the viewport", () => {
    expect(bufferIsShort({ length: 23, baseY: 0, cursorY: 0, rows: 24 })).toBe(true);
  });

  // The renderer and the input handler read different rows, so the cursor row is checked too:
  // this buffer covers the viewport (6 + 24 = 30) but has no line at the cursor, which is where
  // the next line feed writes.
  it("catches a missing cursor row even when the viewport is covered", () => {
    expect(bufferIsShort({ length: 30, baseY: 6, cursorY: 24, rows: 24 })).toBe(true);
  });
});

// The operations a live slot performs: PTY output, fit()'s resize, connect()'s reset, a TUI
// entering and leaving the alternate buffer, and wheel scrolling.
const mkRng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
const noise = (rows: number, width: number) => Array.from({ length: rows }, (_, i) => `r${i} ` + "z".repeat(width)).join("\r\n");

describe("bufferIsShort on a real terminal", () => {
  it("stays quiet through a fresh terminal's first fit and first output", async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    expect(bufferIsShort(readBufferShape(term))).toBe(false);
    term.resize(120, 40);
    expect(bufferIsShort(readBufferShape(term))).toBe(false);
    await write(term, noise(10, 30));
    expect(bufferIsShort(readBufferShape(term))).toBe(false);
    term.dispose();
  });

  it("stays quiet across writes, resizes, resets, alt-buffer switches and scrolling", async () => {
    const SEEDS = 25;
    const OPS_PER_SEED = 60;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rnd = mkRng(seed);
      const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true, scrollback: 1000 });
      let inAltBuffer = false;
      for (let step = 0; step < OPS_PER_SEED; step++) {
        const pick = rnd();
        if (pick < 0.35) {
          term.write(noise(1 + Math.floor(rnd() * 120), 10 + Math.floor(rnd() * 200)));
        } else if (pick < 0.7) {
          term.resize(2 + Math.floor(rnd() * 200), 1 + Math.floor(rnd() * 70));
        } else if (pick < 0.78) {
          term.reset();
          inAltBuffer = false;
        } else if (pick < 0.9) {
          inAltBuffer = !inAltBuffer;
          term.write(inAltBuffer ? "\x1b[?1049h" : "\x1b[?1049l");
        } else {
          term.scrollLines(Math.floor(rnd() * 40) - 20);
        }
        // Both the state the app can observe synchronously and the settled one, since the probe
        // runs on output (mid-stream) and on fit(), and confirms itself a task later.
        expect(bufferIsShort(readBufferShape(term)), `seed ${seed} step ${step}: synchronous`).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(bufferIsShort(readBufferShape(term)), `seed ${seed} step ${step}: settled`).toBe(false);
      }
      term.dispose();
    }
    // A per-test timeout, not the 15s baseline: the floor here is SEEDS * OPS_PER_SEED sequential
    // timer yields, and a yield costs latency rather than work — 1500 of them are already ~1.7s of
    // this file's ~2.3s on macOS, and enough more on a Windows runner to cross 15s with the
    // assertions barely started. Trimming the seeds would buy the time back out of the fuzz
    // coverage, which is the one thing this test exists for.
  }, 60_000);
});
