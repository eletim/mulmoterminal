// Windows-only: the real node-pty spawns that #794 and #798 are about. Skipped everywhere
// else, so this runs in .github/workflows/windows-daily.yaml (which already runs `yarn test`)
// rather than in the PR matrix — the rules themselves are covered by the pure tests in
// infra/resolve-bin.spec and infra/cmd-escape.spec.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pty from "node-pty";
import { spawnPty } from "../../../server/session/pty-spawn";
import { resolvePtyLaunchForEnv } from "../../../server/infra/resolve-bin";

const isWindows = process.platform === "win32";

// A binary that exists ONLY as an .exe, with no extensionless twin — the shape of a Claude
// Code install from the official Windows installer. node.exe stands in for it: it is
// guaranteed present and answers `-e`.
const PROBE = `mt-probe-${process.pid}`;
// A command that exists ONLY as a .cmd — what an npm-global install leaves on PATH.
const SHIM = `mt-shim-${process.pid}`;

const exitCodeOf = (term: pty.IPty): Promise<number> => new Promise((resolve) => term.onExit(({ exitCode }) => resolve(exitCode)));

describe.skipIf(!isWindows)("spawnPty on Windows", () => {
  let dir = "";
  let probeExe = "";
  let shimCmd = "";
  let argsOut = "";
  let originalPath: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mt-probe-"));
    probeExe = path.join(dir, `${PROBE}.exe`);
    copyFileSync(process.execPath, probeExe);

    // The argv the shim's child actually received, recorded to a file rather than stdout: a
    // conpty wraps and escapes what it prints, which would corrupt the comparison.
    argsOut = path.join(dir, "args.json");
    const echoJs = path.join(dir, "echo-args.js");
    writeFileSync(echoJs, `require("node:fs").writeFileSync(process.env.MT_ARGS_OUT, JSON.stringify(process.argv.slice(2)));\n`);
    // Shaped like npm's generated shim: forward %* to a node script. CRLF, as batch files are.
    shimCmd = path.join(dir, `${SHIM}.cmd`);
    writeFileSync(shimCmd, ["@ECHO off", `"${probeExe}" "${echoJs}" %*`, ""].join("\r\n"));

    originalPath = process.env.PATH;
    process.env.PATH = `${dir};${process.env.PATH ?? ""}`;
    process.env.MT_ARGS_OUT = argsOut;
    process.env.MT_MARKER = "expanded-by-cmd";
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    delete process.env.MT_ARGS_OUT;
    delete process.env.MT_MARKER;
    rmSync(dir, { recursive: true, force: true });
  });

  // Run the .cmd shim through spawnPty and return the argv its child received.
  async function argvThroughShim(args: string[]): Promise<string[]> {
    rmSync(argsOut, { force: true });
    const term = spawnPty(SHIM, args, dir);
    expect(await exitCodeOf(term)).toBe(0);
    return JSON.parse(readFileSync(argsOut, "utf8"));
  }

  it("resolves a bare name to the .exe on PATH", () => {
    expect(resolvePtyLaunchForEnv(PROBE, [], process.env)).toEqual({ file: probeExe, args: [] });
  });

  it("spawns a PTY for a bare name whose only match is an .exe", async () => {
    const term = spawnPty(PROBE, ["-e", "process.stdout.write('mt-probe ok')"], dir);
    expect(term.pid).toBeGreaterThan(0);
    let output = "";
    term.onData((data) => {
      output += data;
    });
    expect(await exitCodeOf(term)).toBe(0);
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

  it("resolves a .cmd-only command to cmd.exe with a raw command line", () => {
    const launch = resolvePtyLaunchForEnv(SHIM, ["--resume"], process.env);
    expect(launch.file.toLowerCase()).toContain("cmd.exe");
    expect(launch.args).toBe(`/d /s /c ""${shimCmd}" "--resume""`);
  });

  // Everything below is the empirical half of #798: the escaping is only correct if the
  // argv on the far side of cmd.exe AND the shim's own `%*` forwarding is what we passed.
  it.each([
    ["plain arguments", ["--resume", "abc123"]],
    ["whitespace inside one argument", ["fix the login bug"]],
    ["cmd metacharacters that would otherwise split the command", ["a&b", "c|d", "e>f", "g^h", "(i)"]],
    ["embedded quotes", ['say "hi"']],
    ["a JSON payload, the shape of --settings / --mcp-config", ['{"hooks":{"Stop":[{"command":"curl -s http://127.0.0.1:34567/api/hook"}]}}']],
    ["a path ending in a backslash", ["C:\\Users\\u\\projects\\"]],
    ["non-ASCII", ["ログインの不具合", "修正して"]],
    ["a percent sign with no variable behind it", ["50% done"]],
  ])("round-trips %s through the .cmd shim", async (_case, args) => {
    expect(await argvThroughShim(args)).toEqual(args);
  });

  // The CLAUDE_BIN workaround from #794, applied to an npm-global install: an absolute path
  // skips the PATH search, and a batch file still cannot be handed to CreateProcess.
  it("runs an explicit absolute .cmd path", async () => {
    rmSync(argsOut, { force: true });
    expect(await exitCodeOf(spawnPty(shimCmd, ["--explicit"], dir))).toBe(0);
    expect(JSON.parse(readFileSync(argsOut, "utf8"))).toEqual(["--explicit"]);
  });

  // Pinned, not fixed: cmd expands %VAR% inside double quotes and has no escape for it. See
  // cmd-escape.ts — rejecting every argument containing a percent sign would break ordinary
  // prompts, and substituting our own child's environment into its own argument is a
  // correctness wart rather than a privilege boundary.
  it("expands %VAR% inside an argument — the known limitation of the cmd.exe path", async () => {
    expect(await argvThroughShim(["%MT_MARKER%"])).toEqual(["expanded-by-cmd"]);
  });

  // cmd.exe is an extra process between us and the shim, so a non-zero exit has one more
  // layer to survive than it did before #798.
  it("propagates a failing shim's exit code through the cmd.exe layer", async () => {
    const failing = `mt-fail-${process.pid}`;
    writeFileSync(path.join(dir, `${failing}.cmd`), ["@ECHO off", "exit /b 3", ""].join("\r\n"));
    expect(await exitCodeOf(spawnPty(failing, [], dir))).toBe(3);
  });
});
