import { describe, it, expect } from "vitest";
import { shouldInterceptImagePaste, pastedImageFile } from "../../../src/components/pasteImage.js";

describe("shouldInterceptImagePaste", () => {
  it("intercepts a screenshot — an image and nothing else", () => {
    expect(shouldInterceptImagePaste(["image/png"])).toBe(true);
    expect(shouldInterceptImagePaste(["Files", "image/png"])).toBe(true);
  });

  // An image copied from a web page carries text/html but no text/plain. Saving it is the
  // useful reading of that paste — there is no text to lose.
  it("intercepts an image that came with markup but no text", () => {
    expect(shouldInterceptImagePaste(["text/html", "image/png"])).toBe(true);
  });

  // Copying rich text puts text/plain alongside. Taking those would break pasting text,
  // which is what a terminal is pasted into all day.
  it("leaves a paste that carries text to xterm", () => {
    expect(shouldInterceptImagePaste(["text/plain"])).toBe(false);
    expect(shouldInterceptImagePaste(["text/plain", "text/html", "image/png"])).toBe(false);
    expect(shouldInterceptImagePaste([])).toBe(false);
  });

  // Swallowing a paste the server would then refuse leaves the user with nothing happening
  // at all — worse than letting it through as an ordinary paste.
  it("declines an image type the server cannot save", () => {
    expect(shouldInterceptImagePaste(["image/svg+xml"])).toBe(false);
    expect(shouldInterceptImagePaste(["image/tiff"])).toBe(false);
  });
});

// A DataTransfer stand-in: jsdom has no real clipboard, and the rule under test is about
// what the browser reports, not about the DOM.
function clipboard(types: string[], items: { kind: string; type: string; file: File | null }[]): DataTransfer {
  const list = items.map((item) => ({ kind: item.kind, type: item.type, getAsFile: () => item.file }));
  return { types, items: list } as unknown as DataTransfer;
}

const png = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });

describe("pastedImageFile", () => {
  it("returns the image file when the paste is one to intercept", () => {
    expect(pastedImageFile(clipboard(["image/png"], [{ kind: "file", type: "image/png", file: png }]))).toBe(png);
  });

  it("returns null for a text paste, for no clipboard, and when the item is not a file", () => {
    expect(pastedImageFile(clipboard(["text/plain"], [{ kind: "string", type: "text/plain", file: null }]))).toBeNull();
    expect(pastedImageFile(null)).toBeNull();
    expect(pastedImageFile(clipboard(["image/png"], [{ kind: "string", type: "image/png", file: null }]))).toBeNull();
  });

  // getAsFile() can hand back null even for a file item (a drag that ended, a revoked entry).
  it("returns null when the item yields no file", () => {
    expect(pastedImageFile(clipboard(["image/png"], [{ kind: "file", type: "image/png", file: null }]))).toBeNull();
  });

  it("returns null for an image type the server cannot save", () => {
    const svg = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" });
    expect(pastedImageFile(clipboard(["image/svg+xml"], [{ kind: "file", type: "image/svg+xml", file: svg }]))).toBeNull();
  });
});
