import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, rmSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  decodeImageDataUrl,
  extensionForImageMime,
  pasteImageFilename,
  prunePasteImages,
  resetPasteImageDir,
  withPasteImageDir,
} from "../../../server/files/paste-image-store";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-paste-"));

// A 1x1 PNG, the smallest thing that is genuinely an image file.
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("extensionForImageMime", () => {
  it("maps the formats both agents read", () => {
    expect(extensionForImageMime("image/png")).toBe(".png");
    expect(extensionForImageMime("image/jpeg")).toBe(".jpg");
    expect(extensionForImageMime("image/gif")).toBe(".gif");
    expect(extensionForImageMime("image/webp")).toBe(".webp");
  });

  it("is case- and whitespace-insensitive (a clipboard type arrives as the source wrote it)", () => {
    expect(extensionForImageMime(" IMAGE/PNG ")).toBe(".png");
  });

  // SVG is a script-bearing document, not a screenshot.
  it("refuses svg and non-images", () => {
    expect(extensionForImageMime("image/svg+xml")).toBeNull();
    expect(extensionForImageMime("text/plain")).toBeNull();
    expect(extensionForImageMime("")).toBeNull();
  });
});

describe("decodeImageDataUrl", () => {
  it("decodes a png data URL to its bytes", () => {
    const decoded = decodeImageDataUrl(`data:image/png;base64,${PNG_BASE64}`);
    expect(decoded?.mime).toBe("image/png");
    // PNG magic number — proof the bytes survived, not just that something decoded.
    expect([...(decoded?.bytes.subarray(0, 4) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("rejects a non-image, a non-data URL, and an empty payload", () => {
    expect(decodeImageDataUrl("data:text/plain;base64,aGk=")).toBeNull();
    expect(decodeImageDataUrl("https://example.com/a.png")).toBeNull();
    expect(decodeImageDataUrl("data:image/png;base64,")).toBeNull();
  });

  it("rejects a corrupted payload rather than writing whatever survived the decode", () => {
    expect(decodeImageDataUrl("data:image/png;base64,not base64 at all!!")).toBeNull();
  });
});

describe("pasteImageFilename", () => {
  it("names the file after the moment it was pasted, including milliseconds", () => {
    expect(pasteImageFilename(new Date(2026, 6, 27, 9, 5, 3, 7), "image/png")).toBe("pasted-20260727-090503-007.png");
  });

  it("returns null for a type it cannot name", () => {
    expect(pasteImageFilename(new Date(), "image/svg+xml")).toBeNull();
  });
});

describe("resetPasteImageDir", () => {
  it("empties an existing directory and creates a missing one", () => {
    const root = tmp();
    const dir = path.join(root, "pasted");
    resetPasteImageDir(dir);
    expect(existsSync(dir)).toBe(true);
    writeFileSync(path.join(dir, "old.png"), "x");
    resetPasteImageDir(dir);
    expect(readdirSync(dir)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("prunePasteImages", () => {
  it("keeps the newest files and drops the rest", () => {
    const dir = tmp();
    ["a", "b", "c", "d"].forEach((name, index) => {
      const full = path.join(dir, `${name}.png`);
      writeFileSync(full, "x");
      const seconds = 1_000_000 + index * 60;
      utimesSync(full, seconds, seconds);
    });
    prunePasteImages(dir, 2);
    expect(readdirSync(dir).sort()).toEqual(["c.png", "d.png"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves a directory under the limit alone, and survives a missing one", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.png"), "x");
    prunePasteImages(dir, 5);
    expect(readdirSync(dir)).toEqual(["a.png"]);
    expect(() => prunePasteImages(path.join(dir, "gone"), 1)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("withPasteImageDir", () => {
  // The rest of the list is what the user wrote in .mulmoterminal.json (#908); appending
  // is what keeps this feature from quietly taking their configured dirs away.
  it("appends to the configured dirs instead of replacing them", () => {
    expect(withPasteImageDir(["/a", "/b"], "/paste")).toEqual(["/a", "/b", "/paste"]);
  });

  it("supplies the list when the directory configured none", () => {
    expect(withPasteImageDir(null, "/paste")).toEqual(["/paste"]);
    expect(withPasteImageDir([], "/paste")).toEqual(["/paste"]);
  });

  it("does not repeat a directory the user already listed", () => {
    expect(withPasteImageDir(["/paste", "/a"], "/paste")).toEqual(["/paste", "/a"]);
  });
});
