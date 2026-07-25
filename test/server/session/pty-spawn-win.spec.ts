// Windows-only: the real node-pty spawn that #794 broke. Skipped everywhere else, so it
// runs in .github/workflows/windows-daily.yaml (which already runs `yarn test`) rather than
// in the PR matrix — the rule itself is covered by the pure tests in infra/resolve-bin.spec.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pty from "node-pty";
import { spawnPty } from "../../../server/session/pty-spawn";
import { resolvePtyBinForEnv } from "../../../server/infra/resolve-bin";

const isWindows = process.platform === "win32";

// A binary that exists ONLY as an .exe, with no extensionless twin — the shape of a Claude
// Code install from the official Windows installer. node.exe stands in for it: it is
// guaranteed present and answers `-e`.
const PROBE = `mt-probe-${process.pid}`;

describe.skipIf(!isWindows)("spawnPty on Windows", () => {
  let dir = "";
  let probeExe = "";
  let originalPath: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mt-probe-"));
    probeExe = path.join(dir, `${PROBE}.exe`);
    copyFileSync(process.execPath, probeExe);
    originalPath = process.env.PATH;
    process.env.PATH = `${dir};${process.env.PATH ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a bare name to the .exe on PATH", () => {
    expect(resolvePtyBinForEnv(PROBE, process.env)).toBe(probeExe);
  });

  it("spawns a PTY for a bare name whose only match is an .exe", async () => {
    const term = spawnPty(PROBE, ["-e", "process.stdout.write('mt-probe ok')"], dir);
    expect(term.pid).toBeGreaterThan(0);
    let output = "";
    term.onData((data) => {
      output += data;
    });
    const exitCode = await new Promise<number>((resolve) => term.onExit(({ exitCode }) => resolve(exitCode)));
    expect(exitCode).toBe(0);
    expect(output).toContain("mt-probe ok");
  });

  // The reason resolve-bin.ts exists. When this starts failing, node-pty has learned to
  // resolve executable extensions itself (its src/win/path_util.cc get_shell_path) and the
  // workaround can be reconsidered — it is not a sign that anything here regressed.
  it("pins the node-pty bug it works around: a bare name alone still fails", () => {
    let term: pty.IPty;
    try {
      term = pty.spawn(PROBE, [], { name: "xterm-256color", cols: 80, rows: 24, cwd: dir, env: process.env });
    } catch (err) {
      expect(String(err)).toMatch(/File not found/);
      return;
    }
    term.kill();
    expect.fail("node-pty resolved a bare name on its own — re-check whether infra/resolve-bin.ts is still needed");
  });
});
