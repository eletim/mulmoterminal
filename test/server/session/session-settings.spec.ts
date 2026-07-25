// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { cleanupSessionSettings, settingsArgument, mcpConfigArgument, withSettingsCleanup } from "../../../server/session/session-settings.js";

const SESSION = "settings-spec-session";
const fileFor = (id: string) => path.join(os.homedir(), ".mulmoterminal", "settings", `${id}.json`);
const mcpFileFor = (id: string) => path.join(os.homedir(), ".mulmoterminal", "settings", `${id}-mcp.json`);

afterEach(() => cleanupSessionSettings(SESSION));

describe("settingsArgument", () => {
  // A settings payload with no secret in it keeps travelling inline, so every existing
  // session's spawn is untouched by this feature. The platform is named rather than
  // inherited: Windows has its own reason to use a file (#813, below), so left implicit
  // this would assert the opposite of the truth on the Windows runner.
  it("returns the JSON itself when nothing in it is secret", () => {
    const json = JSON.stringify({ hooks: {} });
    expect(settingsArgument(SESSION, json, false, "linux")).toBe(json);
    expect(existsSync(fileFor(SESSION))).toBe(false);
  });

  // An inline `--settings` is visible to every user on the host through `ps`, and a
  // provider session's settings carry its API token.
  it("writes a private file and returns its path when it is", () => {
    const json = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "sk-secret" }, hooks: {} });
    const arg = settingsArgument(SESSION, json, true);
    expect(arg).toBe(fileFor(SESSION));
    expect(arg).not.toContain("sk-secret");
    expect(readFileSync(arg, "utf8")).toBe(json);
  });

  // The file holds an API token, so who can read it is the point of writing it at all.
  // How that is enforced differs by platform, so the assertion does too: POSIX has mode
  // bits, Windows has none — node maps `mode` to the read-only attribute there and
  // stat reports 0o666 — and the containment below is what protects it instead.
  it("keeps the file inside the user's own profile directory", () => {
    const arg = settingsArgument(SESSION, "{}", true);
    expect(arg.startsWith(path.join(os.homedir(), ".mulmoterminal", "settings") + path.sep)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("keeps the file readable only by its owner", () => {
    const arg = settingsArgument(SESSION, "{}", true);
    expect(statSync(arg).mode & 0o777).toBe(0o600);
  });
});

describe("withSettingsCleanup", () => {
  // A session that never starts never reaches reap(), where the cleanup normally happens
  // — so without this a failed spawn leaves a token-bearing file on disk.
  it("removes the file when the spawn throws, and re-throws", () => {
    settingsArgument(SESSION, '{"env":{"ANTHROPIC_AUTH_TOKEN":"sk-secret"}}', true);
    expect(existsSync(fileFor(SESSION))).toBe(true);
    expect(() =>
      withSettingsCleanup(SESSION, () => {
        throw new Error("spawn failed");
      }),
    ).toThrow(/spawn failed/);
    expect(existsSync(fileFor(SESSION))).toBe(false);
  });

  it("keeps the file — the session needs it — when the spawn succeeds", () => {
    settingsArgument(SESSION, "{}", true);
    expect(withSettingsCleanup(SESSION, () => "entry")).toBe("entry");
    expect(existsSync(fileFor(SESSION))).toBe(true);
  });
});

describe("cleanupSessionSettings", () => {
  it("is a no-op for a session that never wrote one", () => {
    expect(() => cleanupSessionSettings("never-existed-session")).not.toThrow();
  });
});

// #813: on Windows a `.cmd`-installed Claude is launched through cmd.exe, so an inline JSON
// argument is parsed by cmd and then by the child's CRT — two parsers that disagree about
// quoting. A path carries no quotes and no metacharacters, so the layer stops mattering.
describe("the Windows reason for a file", () => {
  const json = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "curl -d @- >/dev/null 2>&1" }] }] } });

  it("writes a file on win32 even when nothing is secret", () => {
    expect(settingsArgument(SESSION, json, false, "win32")).toBe(fileFor(SESSION));
    expect(readFileSync(fileFor(SESSION), "utf8")).toBe(json);
  });

  it("keeps POSIX inline, so a working platform is untouched", () => {
    expect(settingsArgument(SESSION, json, false, "darwin")).toBe(json);
    expect(settingsArgument(SESSION, json, false, "linux")).toBe(json);
    expect(existsSync(fileFor(SESSION))).toBe(false);
  });

  it("gives --mcp-config its own file, so the two never overwrite each other", () => {
    const settings = settingsArgument(SESSION, json, false, "win32");
    const mcp = mcpConfigArgument(SESSION, '{"mcpServers":{}}', "win32");
    expect(mcp).toBe(mcpFileFor(SESSION));
    expect(mcp).not.toBe(settings);
    expect(readFileSync(settings, "utf8")).toBe(json);
    expect(readFileSync(mcp, "utf8")).toBe('{"mcpServers":{}}');
  });

  it("passes --mcp-config inline off Windows", () => {
    expect(mcpConfigArgument(SESSION, "{}", "darwin")).toBe("{}");
  });

  // reap() calls this once per session; it has to take BOTH files or the mcp one outlives
  // every Windows session.
  it("cleans up both files", () => {
    settingsArgument(SESSION, json, false, "win32");
    mcpConfigArgument(SESSION, "{}", "win32");
    cleanupSessionSettings(SESSION);
    expect(existsSync(fileFor(SESSION))).toBe(false);
    expect(existsSync(mcpFileFor(SESSION))).toBe(false);
  });
});
