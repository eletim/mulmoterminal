import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, rmSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  decodeImageDataUrl,
  pasteImageFilename,
  pasteImageToken,
  preparePasteImageDir,
  prunePasteImages,
  withPasteImageDir,
} from "../../../server/files/paste-image-store";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-paste-"));

// A 1x1 PNG, the smallest thing that is genuinely an image file.
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
    expect(pasteImageFilename(new Date(2026, 6, 27, 9, 5, 3, 7), "image/png", "ab12cd34")).toBe("pasted-20260727-090503-007-ab12cd34.png");
  });

  // Two terminals can paste in the same millisecond; without the token the second write
  // renames over the first, and the first terminal's inserted path then points at the
  // wrong screenshot.
  it("distinguishes two pastes that share a millisecond", () => {
    const at = new Date(2026, 6, 27, 9, 5, 3, 7);
    expect(pasteImageFilename(at, "image/png", "aaaaaaaa")).not.toBe(pasteImageFilename(at, "image/png", "bbbbbbbb"));
  });

  it("returns null for a type it cannot name", () => {
    expect(pasteImageFilename(new Date(), "image/svg+xml", "ab12cd34")).toBeNull();
  });
});

describe("pasteImageToken", () => {
  it("is short and does not repeat", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => pasteImageToken()));
    expect(tokens.size).toBe(50);
    [...tokens].forEach((token) => expect(token).toMatch(/^[0-9a-f]{8}$/));
  });
});

describe("preparePasteImageDir", () => {
  const HOUR_MS = 60 * 60 * 1000;

  it("creates a missing directory", () => {
    const root = tmp();
    const dir = path.join(root, "pasted");
    preparePasteImageDir(dir);
    expect(existsSync(dir)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  // A tmux-backed session outlives a server restart, so a conversation can still hold a path
  // handed out by the previous run. Emptying the directory would break exactly those.
  it("drops what has aged out and keeps what a surviving session may still read", () => {
    const dir = tmp();
    const now_ms = 100 * HOUR_MS;
    writeFileSync(path.join(dir, "old.png"), "x");
    utimesSync(path.join(dir, "old.png"), (now_ms - 30 * HOUR_MS) / 1000, (now_ms - 30 * HOUR_MS) / 1000);
    writeFileSync(path.join(dir, "recent.png"), "x");
    utimesSync(path.join(dir, "recent.png"), (now_ms - HOUR_MS) / 1000, (now_ms - HOUR_MS) / 1000);
    preparePasteImageDir(dir, now_ms, 24 * HOUR_MS);
    expect(readdirSync(dir)).toEqual(["recent.png"]);
    rmSync(dir, { recursive: true, force: true });
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
