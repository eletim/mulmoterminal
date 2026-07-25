import { describe, it, expect } from "vitest";
import { resolveWindowsExecutable, resolvePtyBin } from "../../../server/infra/resolve-bin";

// A fake Windows filesystem: the exact set of files that exist, matched case-insensitively
// the way Windows does.
const filesystem = (...files: string[]) => {
  const present = new Set(files.map((file) => file.toLowerCase()));
  return (candidate: string) => present.has(candidate.toLowerCase());
};

const LOCAL_BIN = "C:\\Users\\u\\.local\\bin";
const SYSTEM32 = "C:\\Windows\\System32";

describe("resolveWindowsExecutable", () => {
  it("finds the .exe a bare name refers to (the #794 case: no extensionless shim exists)", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.exe`);
    expect(resolveWindowsExecutable("claude", `${SYSTEM32};${LOCAL_BIN};C:\\tools`, exists)).toBe(`${LOCAL_BIN}\\claude.exe`);
  });

  it("searches the LAST PATH entry — node-pty's own splitter never pushes the segment after the final ';'", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.exe`);
    expect(resolveWindowsExecutable("claude", `${SYSTEM32};${LOCAL_BIN}`, exists)).toBe(`${LOCAL_BIN}\\claude.exe`);
  });

  it("takes the first PATH directory that has it", () => {
    const exists = filesystem(`${SYSTEM32}\\tmux.exe`, `${LOCAL_BIN}\\tmux.exe`);
    expect(resolveWindowsExecutable("tmux", `${SYSTEM32};${LOCAL_BIN}`, exists)).toBe(`${SYSTEM32}\\tmux.exe`);
  });

  it("prefers .exe over .com in the same directory, since a bare name would have reached the .exe", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.com`, `${LOCAL_BIN}\\claude.exe`);
    expect(resolveWindowsExecutable("claude", LOCAL_BIN, exists)).toBe(`${LOCAL_BIN}\\claude.exe`);
  });

  it("finds a .com when that is the only candidate", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.com`);
    expect(resolveWindowsExecutable("claude", LOCAL_BIN, exists)).toBe(`${LOCAL_BIN}\\claude.com`);
  });

  // CreateProcessW — which node-pty calls right after the lookup this feeds — runs PE images
  // only. Naming a shim directly breaks a spawn that works today, where the shim merely
  // satisfies node-pty's existence gate and CreateProcess finds the real .exe further down PATH.
  it("ignores an extensionless shim and keeps looking for a real executable (the codex case)", () => {
    const exists = filesystem(`${LOCAL_BIN}\\codex`, `${SYSTEM32}\\codex.exe`);
    expect(resolveWindowsExecutable("codex", `${LOCAL_BIN};${SYSTEM32}`, exists)).toBe(`${SYSTEM32}\\codex.exe`);
  });

  it("ignores .cmd / .bat / .ps1 — CreateProcess cannot execute them", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.cmd`, `${LOCAL_BIN}\\claude.bat`, `${LOCAL_BIN}\\claude.ps1`);
    expect(resolveWindowsExecutable("claude", LOCAL_BIN, exists)).toBeNull();
  });

  it("matches a name that already carries .exe exactly, without appending another extension", () => {
    const exists = filesystem(`${SYSTEM32}\\powershell.exe`);
    expect(resolveWindowsExecutable("powershell.exe", SYSTEM32, exists)).toBe(`${SYSTEM32}\\powershell.exe`);
    expect(resolveWindowsExecutable("powershell.exe", SYSTEM32, filesystem(`${SYSTEM32}\\powershell.exe.exe`))).toBeNull();
  });

  it("matches the given extension case-insensitively", () => {
    const exists = filesystem(`${SYSTEM32}\\powershell.exe`);
    expect(resolveWindowsExecutable("PowerShell.EXE", SYSTEM32, exists)).toBe(`${SYSTEM32}\\PowerShell.EXE`);
  });

  it("leaves a name that already names a path alone — node-pty resolves those itself", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.exe`);
    expect(resolveWindowsExecutable(`${LOCAL_BIN}\\claude.exe`, LOCAL_BIN, exists)).toBeNull();
    expect(resolveWindowsExecutable("bin\\claude", LOCAL_BIN, exists)).toBeNull();
    expect(resolveWindowsExecutable("./claude", LOCAL_BIN, exists)).toBeNull();
  });

  it("returns null for an empty name, an empty PATH, and a missing PATH", () => {
    const exists = filesystem(`${LOCAL_BIN}\\claude.exe`);
    expect(resolveWindowsExecutable("", `${LOCAL_BIN}`, exists)).toBeNull();
    expect(resolveWindowsExecutable("claude", "", exists)).toBeNull();
    expect(resolveWindowsExecutable("claude", undefined, exists)).toBeNull();
  });

  it("skips empty PATH entries rather than resolving against the cwd", () => {
    const seen: string[] = [];
    const exists = (candidate: string) => {
      seen.push(candidate);
      return candidate === `${LOCAL_BIN}\\claude.exe`;
    };
    expect(resolveWindowsExecutable("claude", `;;${LOCAL_BIN};`, exists)).toBe(`${LOCAL_BIN}\\claude.exe`);
    expect(seen).toEqual([`${LOCAL_BIN}\\claude.exe`]);
  });

  it("unquotes a PATH entry, the way a shell does", () => {
    const programFiles = "C:\\Program Files\\tools";
    const exists = filesystem(`${programFiles}\\tmux.exe`);
    expect(resolveWindowsExecutable("tmux", `"${programFiles}"`, exists)).toBe(`${programFiles}\\tmux.exe`);
  });

  it("returns null when nothing on PATH matches", () => {
    expect(resolveWindowsExecutable("claude", `${SYSTEM32};${LOCAL_BIN}`, filesystem(`${SYSTEM32}\\codex.exe`))).toBeNull();
  });
});

describe("resolvePtyBin", () => {
  it("is a no-op off Windows even when a candidate would match — node-pty resolves bare names there", () => {
    const everythingExists = () => true;
    expect(resolvePtyBin("claude", "darwin", "/usr/local/bin", everythingExists)).toBe("claude");
    expect(resolvePtyBin("claude", "linux", "/usr/local/bin", everythingExists)).toBe("claude");
    expect(resolvePtyBin("claude", "win32", "C:\\bin", everythingExists)).toBe("C:\\bin\\claude.exe");
  });

  it("keeps the bare name on Windows when nothing resolves, so a host that works today still works", () => {
    expect(resolvePtyBin("claude", "win32", "C:\\nowhere")).toBe("claude");
  });
});
