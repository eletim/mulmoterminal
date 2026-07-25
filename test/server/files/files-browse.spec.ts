import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listEntries, mdToHtmlDoc } from "../../../server/files/files-browse";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-files-"));

describe("listEntries", () => {
  it("lists directories first, then files, each alphabetical, with sizes", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "zsub"));
    mkdirSync(path.join(dir, "asub"));
    writeFileSync(path.join(dir, "b.txt"), "hello");
    writeFileSync(path.join(dir, "a.md"), "# hi");
    const entries = listEntries(dir);
    expect(entries.map((e) => e.name)).toEqual(["asub", "zsub", "a.md", "b.txt"]);
    expect(entries.find((e) => e.name === "b.txt")).toMatchObject({ dir: false, size: 5 });
    expect(entries.find((e) => e.name === "asub")).toMatchObject({ dir: true });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mdToHtmlDoc", () => {
  it("wraps body HTML and escapes the title", () => {
    const doc = mdToHtmlDoc("<p>x</p>", "a<b>.md");
    expect(doc).toContain("<p>x</p>");
    expect(doc).toContain("<title>a&lt;b&gt;.md</title>");
    expect(doc.startsWith("<!doctype html>")).toBe(true);
  });

  // The page opens in its own tab under a sandbox CSP, so it cannot ask the app which theme
  // is on — it has to follow the reader's system setting instead of flashing white (#808).
  it("follows the reader's colour scheme", () => {
    const doc = mdToHtmlDoc("<p>x</p>", "a.md");
    expect(doc).toContain("color-scheme:light dark");
    expect(doc).toContain("@media(prefers-color-scheme:dark)");
  });

  // Everything is inlined on purpose: a sandboxed document fetching a stylesheet or a font
  // would be a request the CSP has to allow, for styling that has to work offline anyway.
  it("stays self-contained — no external stylesheet, script or font", () => {
    const doc = mdToHtmlDoc("<p>x</p>", "a.md");
    expect(doc).not.toContain("<link");
    expect(doc).not.toContain("<script");
    expect(doc).not.toMatch(/https?:\/\//);
  });
});
