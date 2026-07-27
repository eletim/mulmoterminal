// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TERMINAL_CJK_FAMILIES } from "../../common/terminalFontFamily.js";

// Tailwind's `--font-mono` has to restate the CJK tail because CSS cannot import from common/.
// These specs are what stops the restatement drifting from the shared list.
const cssFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "tailwind.css");

const unquote = (name: string): string => name.replace(/^["']|["']$/g, "");

function fontMonoFamilies(): string[] {
  const css = readFileSync(cssFile, "utf8");
  const declaration = /--font-mono:([^;]*);/.exec(css);
  if (!declaration) throw new Error(`--font-mono not found in ${cssFile}`);
  return declaration[1]
    .split(",")
    .map((name) => unquote(name.trim()))
    .filter(Boolean);
}

describe("tailwind --font-mono", () => {
  it("carries every shared CJK family, in the same order", () => {
    const families = fontMonoFamilies();
    const shared = TERMINAL_CJK_FAMILIES.map(unquote);
    expect(families.filter((name) => shared.includes(name))).toEqual(shared);
  });

  // The chrome's Latin head is intentionally NOT the terminal's — the terminal leads with
  // JetBrains Mono, the chrome with the platform face. Pinned so "make them consistent" is a
  // deliberate decision someone has to come here and change, not an accident.
  it("keeps its own Latin head, ahead of the CJK tail", () => {
    const families = fontMonoFamilies();
    expect(families.slice(0, 2)).toEqual(["ui-monospace", "JetBrains Mono"]);
    expect(families.indexOf("Noto Sans Mono CJK JP")).toBe(2);
  });

  // A stack with no generic tail falls back to the browser's PROPORTIONAL default, which in the
  // chrome means misaligned diff columns and header text.
  it("ends in the generic monospace keyword, unquoted so CSS reads it as generic", () => {
    const css = readFileSync(cssFile, "utf8");
    expect(/--font-mono:[^;]*,\s*monospace;/.test(css)).toBe(true);
    expect(fontMonoFamilies().at(-1)).toBe("monospace");
  });
});
