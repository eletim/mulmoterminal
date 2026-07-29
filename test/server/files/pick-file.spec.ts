import { describe, it, expect } from "vitest";
import { pickFileCommand, parsePickerOutput } from "../../../server/files/pick-file.js";

describe("pickFileCommand", () => {
  it("uses osascript on macOS", () => {
    expect(pickFileCommand("darwin").cmd).toBe("osascript");
  });
  it("uses powershell on Windows", () => {
    expect(pickFileCommand("win32").cmd).toBe("powershell");
  });
  it("falls back to zenity elsewhere (Linux)", () => {
    expect(pickFileCommand("linux").cmd).toBe("zenity");
  });
});

describe("pickFileCommand (directory mode)", () => {
  it("macOS: osascript 'choose folder'", () => {
    const { cmd, args } = pickFileCommand("darwin", true);
    expect(cmd).toBe("osascript");
    expect(args.join(" ")).toContain("choose folder");
  });
  // #1003: the folder picker asks the shell for its own dialog (the Explorer-style one), and
  // keeps the legacy tree only as the catch — so a runtime that cannot compile the interop still
  // lets the user choose a directory.
  it("Windows: the shell's IFileOpenDialog, with the legacy tree as the fallback", () => {
    const script = pickFileCommand("win32", true).args.join(" ");
    expect(script).toContain("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7"); // CLSID_FileOpenDialog
    expect(script).toContain("0x20"); // FOS_PICKFOLDERS — without it this picks files
    expect(script).toContain("FolderBrowserDialog"); // the fallback, inside `catch`
    expect(script).toMatch(/catch \{[\s\S]*FolderBrowserDialog/); // ...and only there
  });

  // COM dispatches by vtable slot, so the declaration order is behaviour: a missing or reordered
  // member calls a different function than the name says. Pinning the two that this depends on
  // catches a "tidy up the unused ones" edit.
  it("Windows: keeps the IFileDialog vtable order the interop depends on", () => {
    const script = pickFileCommand("win32", true).args.join(" ");
    const order = ["int Show(", "SetFileTypes(", "SetOptions(", "GetOptions(", "GetResult("];
    const positions = order.map((member) => script.indexOf(member));
    expect(positions.every((at) => at > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  // A PowerShell here-string ends only at a `'@` that starts its own line. Reflow the template and
  // the whole script becomes a syntax error — which nothing else here would notice.
  it("Windows: closes its here-string at the start of a line", () => {
    expect(pickFileCommand("win32", true).args[3]).toContain("\n'@");
  });
  it("Linux: zenity --directory", () => {
    expect(pickFileCommand("linux", true).args).toContain("--directory");
  });
  it("file mode (default) is unchanged", () => {
    expect(pickFileCommand("darwin").args.join(" ")).toContain("choose file");
    expect(pickFileCommand("win32").args.join(" ")).toContain("OpenFileDialog");
    expect(pickFileCommand("linux").args).toContain("--multiple");
  });
});

describe("parsePickerOutput", () => {
  it("splits newline-separated absolute paths", () => {
    expect(parsePickerOutput("/a/b.txt\n/c/d.txt")).toEqual(["/a/b.txt", "/c/d.txt"]);
  });
  it("trims and drops blank lines", () => {
    expect(parsePickerOutput("  /a.txt  \n\n")).toEqual(["/a.txt"]);
  });
  it("handles CRLF output", () => {
    expect(parsePickerOutput("/a.txt\r\n/b.txt\r\n")).toEqual(["/a.txt", "/b.txt"]);
  });
  it("rejects relative or junk lines (e.g. a cancel message)", () => {
    expect(parsePickerOutput("not a path\nrelative/p.txt")).toEqual([]);
  });
  it("returns empty for empty output (user canceled)", () => {
    expect(parsePickerOutput("")).toEqual([]);
  });
});
