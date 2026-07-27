import { describe, it, expect } from "vitest";
import { isWriteToOpenFile } from "../../../src/composables/fileWriteMatch";

describe("isWriteToOpenFile", () => {
  it("matches the open file", () => {
    expect(isWriteToOpenFile("/proj/src/a.ts", "/proj", "src/a.ts")).toBe(true);
  });

  it("ignores a write to a different file in the same project", () => {
    expect(isWriteToOpenFile("/proj/src/b.ts", "/proj", "src/a.ts")).toBe(false);
  });

  it("ignores the same relative path in a different project", () => {
    expect(isWriteToOpenFile("/other/src/a.ts", "/proj", "src/a.ts")).toBe(false);
  });

  // The server resolves the path with the platform's own separators.
  it("matches across separator styles and a trailing slash on the root", () => {
    expect(isWriteToOpenFile("C:\\proj\\src\\a.ts", "C:/proj", "src/a.ts")).toBe(true);
    expect(isWriteToOpenFile("/proj/src/a.ts", "/proj/", "src/a.ts")).toBe(true);
  });

  // Being case-insensitive costs one redundant version check on a case-sensitive filesystem;
  // being case-SENSITIVE would miss the notification entirely on macOS and Windows.
  it("matches regardless of case", () => {
    expect(isWriteToOpenFile("/Proj/Src/A.ts", "/proj", "src/a.ts")).toBe(true);
  });

  it("has nothing to match when no file is open", () => {
    expect(isWriteToOpenFile("/proj/src/a.ts", "/proj", null)).toBe(false);
    expect(isWriteToOpenFile("/proj/src/a.ts", null, "src/a.ts")).toBe(false);
  });
});
