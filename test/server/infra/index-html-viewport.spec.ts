// @vitest-environment node
// Pins the repo's index.html viewport meta tag — the source of behaviour
// MobileTerminalPage.vue's h-dvh root comment depends on (its Android software-keyboard
// handling only works because index.html opts into interactive-widget=resizes-content).
// Lives alongside spa-fallback.spec.ts since both cover what actually gets served as the SPA
// shell; nothing else in the suite touches index.html directly, so a regression here (a dropped
// attribute, a duplicated tag) would otherwise only surface on a real device.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const indexHtml = readFileSync(path.join(__dirname, "..", "..", "..", "index.html"), "utf-8");

describe("index.html viewport meta", () => {
  it("has exactly one viewport meta tag", () => {
    const matches = indexHtml.match(/<meta\s+name="viewport"/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("keeps width=device-width and initial-scale=1.0", () => {
    const [tag] = indexHtml.match(/<meta name="viewport" content="[^"]*"/) ?? [];
    expect(tag).toBeDefined();
    expect(tag).toContain("width=device-width");
    expect(tag).toContain("initial-scale=1.0");
  });

  // On supporting Android browsers this makes the layout viewport — and any dvh unit sized off
  // it — shrink when the on-screen keyboard opens, instead of the keyboard just overlaying
  // fixed-size content. MobileTerminalPage.vue's h-dvh root relies on this for its input footer
  // to stay above the keyboard.
  it("opts into interactive-widget=resizes-content", () => {
    const [tag] = indexHtml.match(/<meta name="viewport" content="[^"]*"/) ?? [];
    expect(tag).toContain("interactive-widget=resizes-content");
  });
});
