import { describe, it, expect } from "vitest";

import { SOURCE_CODE_EXTENSIONS } from "../../common/sourceExtensions";
import { rawServingPlan } from "../../server/backends/rawServingPlan";
import { fileLinkTarget } from "../../src/composables/terminalFilePathLinkProvider";

// The two callers of SOURCE_CODE_EXTENSIONS answer DIFFERENT questions from it and each
// adds its own extras, so what needs pinning is not the shared list — it's that neither
// side's total answer moved when the list was factored out (#826).
//
// These are the deliberate asymmetries. Widening one of them "for symmetry" changes
// behaviour: `.md` opening in the Files view instead of the rendered markdown route,
// `.txt` no longer opening there at all.
const SERVED_AS_TEXT_BEYOND_SOURCE = [
  ".md",
  ".markdown",
  ".rst",
  ".adoc",
  ".mdx",
  ".pl",
  ".r",
  ".dart",
  ".ex",
  ".exs",
  ".env",
  ".properties",
  ".html",
  ".htm",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".lock",
];

const OPENED_IN_APP_BEYOND_SOURCE = [".txt"];

const servesAsText = (ext: string): boolean => rawServingPlan(`/w/file${ext}`, 1).contentType === "text/plain; charset=utf-8";
const opensInApp = (ext: string): boolean => fileLinkTarget(`/w/file${ext}`, "/w").kind === "files";

describe("SOURCE_CODE_EXTENSIONS", () => {
  it("is the intersection of the two callers' answers — every entry does both things", () => {
    for (const ext of SOURCE_CODE_EXTENSIONS) {
      expect(servesAsText(ext), `${ext} should be served as text/plain`).toBe(true);
      expect(opensInApp(ext), `${ext} should open in the Files view`).toBe(true);
    }
  });

  it("holds nothing that belongs to only one caller", () => {
    const shared = new Set<string>(SOURCE_CODE_EXTENSIONS);
    for (const ext of [...SERVED_AS_TEXT_BEYOND_SOURCE, ...OPENED_IN_APP_BEYOND_SOURCE]) {
      expect(shared.has(ext), `${ext} is one side's extra and must stay out of the shared set`).toBe(false);
    }
  });
});

describe("the deliberate asymmetries between the two callers", () => {
  it("serves docs, markup and dotfiles as text without opening them in the Files view", () => {
    for (const ext of SERVED_AS_TEXT_BEYOND_SOURCE) {
      expect(servesAsText(ext), `${ext} should be served as text/plain`).toBe(true);
      expect(opensInApp(ext), `${ext} should open at a URL, not in the Files view`).toBe(false);
    }
  });

  it("opens .txt in the Files view, and still serves it as text via the mime table", () => {
    for (const ext of OPENED_IN_APP_BEYOND_SOURCE) {
      expect(opensInApp(ext)).toBe(true);
      expect(servesAsText(ext)).toBe(true);
    }
  });

  it("routes markdown to the rendered viewer rather than the raw route", () => {
    const target = fileLinkTarget("/w/README.md", "/w");
    expect(target.kind).toBe("url");
    expect(target.kind === "url" && target.url).toContain("/api/files/browse/md");
  });

  it("leaves an unknown extension downloadable and out of the Files view", () => {
    expect(rawServingPlan("/w/thing.bin", 1).contentType).toBe("application/octet-stream");
    expect(opensInApp(".bin")).toBe(false);
  });
});
