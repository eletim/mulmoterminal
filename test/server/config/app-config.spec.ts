// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  sanitizeSoundFile,
  sanitizeLaunchers,
  sanitizeQuickCommands,
  sanitizePushKinds,
  sanitizeUserMcpServers,
  sanitizePrWorkdirFooter,
  sanitizeCopyOnSelect,
  sanitizeTerminalSubmit,
  loadAppConfig,
  loadAppConfigResult,
  backupCorruptConfig,
  emptyConfig,
  saveAppConfig,
  mergeConfigUpdate,
} from "../../../server/config/app-config";
import { DEFAULT_PUSH_KINDS } from "../../../common/pushKinds.js";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-appcfg-"));

describe("app config sanitizers", () => {
  it("keeps terminal-facing settings and drops malformed values", () => {
    expect(sanitizeSoundFile("  /a/b.wav ")).toBe("/a/b.wav");
    expect(sanitizeSoundFile("relative.wav")).toBeNull();
    expect(sanitizeCopyOnSelect(true)).toBe(true);
    expect(sanitizeCopyOnSelect("true")).toBe(false);
    expect(sanitizePrWorkdirFooter(false)).toBe(false);
    expect(sanitizePrWorkdirFooter(undefined)).toBe(true);
    expect(sanitizeTerminalSubmit("esc-cr")).toBe("esc-cr");
    expect(sanitizeTerminalSubmit("bogus")).toBe("cr");
  });

  it("keeps launchers, quick commands, push kinds, and user MCP servers", () => {
    expect(
      sanitizeLaunchers([
        { label: " Shell ", command: " $SHELL " },
        { label: "", command: "x" },
      ]),
    ).toEqual([{ label: "Shell", command: "$SHELL" }]);
    expect(
      sanitizeQuickCommands([
        { label: " PR ", text: " 作って " },
        { label: "bad", text: "" },
      ]),
    ).toEqual([{ label: "PR", text: "作って" }]);
    expect(sanitizePushKinds(["waiting", "finished", "waiting"])).toEqual(["finished", "waiting"]);
    expect(sanitizePushKinds(undefined)).toEqual([...DEFAULT_PUSH_KINDS]);
    expect(
      sanitizeUserMcpServers([
        { id: "docs", url: "https://example.com/mcp" },
        { id: "bad id", url: "nope" },
      ]),
    ).toEqual([{ id: "docs", url: "https://example.com/mcp" }]);
  });
});

describe("loadAppConfig / saveAppConfig", () => {
  it("round-trips the current public config without removed feature fields", () => {
    const dir = tmp();
    const file = path.join(dir, "nested", "config.json");
    const cfg = {
      ...emptyConfig(),
      cwdPresets: [{ label: "x", path: path.resolve("/x") }],
      launchers: [{ label: "Shell", command: "$SHELL" }],
      quickCommands: [{ label: "PR", text: "PR作って" }],
      userMcpServers: [{ id: "weather", url: "http://localhost:9000/mcp" }],
      terminalSubmit: "esc-cr" as const,
      copyOnSelect: true,
      prWorkdirFooter: false,
      appendSystemPrompt: false,
      fontFamily: "Cica, monospace",
    };
    expect(saveAppConfig(file, cfg, {})).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(cfg);
    expect(loadAppConfig(file)).toEqual(cfg);
    expect(Object.keys(loadAppConfig(file))).not.toEqual(
      expect.arrayContaining(["prRepos", "repoDirs", "worklogEnabled", "worklogIntervalHours", "decisionDigest"]),
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("sanitizes junk and ignores removed feature fields on load", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        cwdPresets: [{ label: "a", path: "/a" }],
        prRepos: ["o/r"],
        repoDirs: { "o/r": "/w/r" },
        worklogEnabled: true,
        worklogIntervalHours: 12,
        decisionDigest: true,
        launchers: [{ label: "S", command: "sh" }],
        terminalSubmit: "bogus",
      }),
    );
    expect(loadAppConfig(file)).toEqual({
      ...emptyConfig(),
      cwdPresets: [{ label: "a", path: path.resolve("/a") }],
      launchers: [{ label: "S", command: "sh" }],
      terminalSubmit: "cr",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves unknown keys on save without exposing removed keys as config", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    const unknown = { futureFeature: "on", prRepos: ["o/r"] };
    expect(saveAppConfig(file, emptyConfig(), unknown)).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(onDisk.futureFeature).toBe("on");
    expect(onDisk.prRepos).toEqual(["o/r"]);
    expect(loadAppConfig(file)).toEqual(emptyConfig());
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("loadAppConfigResult", () => {
  it("distinguishes missing, corrupt, and ok files", () => {
    const dir = tmp();
    expect(loadAppConfigResult(path.join(dir, "none.json"))).toEqual({ status: "missing" });

    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(loadAppConfigResult(bad).status).toBe("corrupt");

    const good = path.join(dir, "good.json");
    writeFileSync(good, JSON.stringify({ pushKinds: ["finished"] }));
    expect(loadAppConfigResult(good)).toMatchObject({ status: "ok", config: { pushKinds: ["finished"] } });
    rmSync(dir, { recursive: true, force: true });
  });

  it("backs up a corrupt config before a write path refuses it", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(file, "{ not json");
    const bak = backupCorruptConfig(file);
    expect(bak).toBe(`${file}.corrupt.bak`);
    expect(bak && existsSync(bak)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mergeConfigUpdate", () => {
  it("keeps omitted terminal settings and ignores removed feature fields", () => {
    const base = { ...emptyConfig(), copyOnSelect: true, prWorkdirFooter: false, terminalSubmit: "esc-cr" as const };
    const next = mergeConfigUpdate(base, { chips: ["git"], prRepos: ["o/r"], worklogEnabled: true });
    expect(next).toEqual({ ...base, chips: ["git"] });
  });
});
