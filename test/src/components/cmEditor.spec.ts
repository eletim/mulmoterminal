import { describe, it, expect } from "vitest";
import { langKindForFilename, langExtensionForKind } from "../../../src/components/cmEditor.js";

describe("langKindForFilename", () => {
  it("maps markdown extensions", () => {
    expect(langKindForFilename("README.md")).toBe("markdown");
    expect(langKindForFilename("notes.markdown")).toBe("markdown");
    expect(langKindForFilename("doc.MDX")).toBe("markdown");
  });
  it("maps javascript/typescript extensions", () => {
    for (const f of ["a.js", "a.jsx", "a.ts", "a.tsx", "a.mjs", "a.cjs"]) {
      expect(langKindForFilename(f)).toBe("javascript");
    }
  });
  it("maps json", () => {
    expect(langKindForFilename("package.json")).toBe("json");
  });
  it("falls back to text for unknown or extension-less files", () => {
    expect(langKindForFilename("Makefile")).toBe("text");
    expect(langKindForFilename("LICENSE")).toBe("text");
    expect(langKindForFilename("data.csv")).toBe("text");
    expect(langKindForFilename(".gitignore")).toBe("text");
  });
});

// The languages added in one go (a .vue file editing as grey plain text is what prompted it).
describe("langKindForFilename — the rest of the bundled modes", () => {
  // A single-file component is an HTML document with <script> and <style> in it, and the html
  // mode switches into JS and CSS inside those tags — one dependency colours all three.
  it.each(["App.vue", "Card.svelte", "index.astro", "page.html", "page.htm"])("maps %s to html", (name) => {
    expect(langKindForFilename(name)).toBe("html");
  });

  it.each([
    ["style.css", "css"],
    ["theme.scss", "css"],
    ["old.less", "css"],
    ["config.yaml", "yaml"],
    ["ci.yml", "yaml"],
    ["icon.svg", "xml"],
    ["pom.xml", "xml"],
    ["main.py", "python"],
    ["lib.rs", "rust"],
    ["main.go", "go"],
    ["App.java", "java"],
    ["Main.kt", "java"],
    ["main.c", "cpp"],
    ["header.h", "cpp"],
    ["main.cpp", "cpp"],
    ["index.php", "php"],
    ["schema.sql", "sql"],
  ])("maps %s to %s", (name, kind) => {
    expect(langKindForFilename(name)).toBe(kind);
  });

  it("is case-insensitive about the extension", () => {
    expect(langKindForFilename("App.VUE")).toBe("html");
    expect(langKindForFilename("MAIN.PY")).toBe("python");
  });

  // Two modes claiming one extension would make the answer depend on table order.
  it("gives every extension to exactly one mode", () => {
    const all = [
      "md,markdown,mdx",
      "js,jsx,ts,tsx,mjs,cjs",
      "json,jsonc,json5",
      "html,htm,vue,svelte,astro",
      "css,scss,less,sass",
      "yaml,yml",
      "xml,svg,xsl,plist",
      "py,pyi,pyw",
      "rs",
      "go",
      "java,kt,kts",
      "c,h,cc,cpp,cxx,hpp,hh,m,mm",
      "php",
      "sql",
    ]
      .flatMap((group) => group.split(","))
      .map((ext) => `file.${ext}`);
    expect(new Set(all).size).toBe(all.length);
    all.forEach((name) => expect(langKindForFilename(name), name).not.toBe("text"));
  });

  it("still falls back to text for something we do not bundle", () => {
    expect(langKindForFilename("archive.zip")).toBe("text");
    expect(langKindForFilename("notes.org")).toBe("text");
  });
});

// What is paid for on page load versus fetched on demand. The three that were always here are
// this app's own file types, so they stay in the bundle and colour the moment a file opens; the
// rest cost 462 kB raw / 163 kB gzip if bundled, for grammars most sessions never touch.
describe("which modes are bundled", () => {
  it.each(["markdown", "javascript", "json"] as const)("applies %s without a round trip", (kind) => {
    expect(langExtensionForKind(kind)).not.toBeInstanceOf(Promise);
  });

  it.each(["html", "css", "yaml", "xml", "python", "rust", "go", "java", "cpp", "php", "sql"] as const)("fetches %s on demand", (kind) => {
    expect(langExtensionForKind(kind)).toBeInstanceOf(Promise);
  });

  it("has nothing to apply for plain text", () => {
    expect(langExtensionForKind("text")).toEqual([]);
  });
});
