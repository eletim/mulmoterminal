// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeRetiredCodexMcpTables, runUpgradeCleanup, type UpgradeCleanupResult } from "../../../server/infra/upgrade-cleanup.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-upgrade-cleanup-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const writeJson = (file: string, value: unknown): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
};

const readJson = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

const makeOwnedSkill = (root: string, name: string): void => {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `# ${name}`);
  writeFileSync(path.join(dir, ".mt-owned"), "managed by mulmoterminal\n");
};

describe("runUpgradeCleanup", () => {
  it("removes marker-owned retired skills but preserves user-authored same-name skills", () => {
    const home = tmp();
    const codexHome = path.join(home, "codex-home");
    const claudeSkills = path.join(home, ".claude", "skills");
    const codexSkills = path.join(codexHome, "skills");
    makeOwnedSkill(claudeSkills, "mulmoterminal-config");
    makeOwnedSkill(codexSkills, "mulmoterminal-notify");
    mkdirSync(path.join(codexSkills, "workspace-skill"), { recursive: true });
    writeFileSync(path.join(codexSkills, "workspace-skill", "SKILL.md"), "# mirrored workspace skill");
    writeFileSync(path.join(codexSkills, "workspace-skill", ".mt-mirror"), "mirrored by mulmoterminal\n");
    mkdirSync(path.join(codexSkills, "user-skill"), { recursive: true });
    writeFileSync(path.join(codexSkills, "user-skill", "SKILL.md"), "# user skill");
    mkdirSync(path.join(claudeSkills, "mulmoterminal-dirs"), { recursive: true });
    writeFileSync(path.join(claudeSkills, "mulmoterminal-dirs", "SKILL.md"), "# user skill");

    const result = runUpgradeCleanup({ home, codexHome });

    expect(result.ownedSkillsRemoved).toBe(3);
    expect(existsSync(path.join(claudeSkills, "mulmoterminal-config"))).toBe(false);
    expect(existsSync(path.join(codexSkills, "mulmoterminal-notify"))).toBe(false);
    expect(existsSync(path.join(codexSkills, "workspace-skill"))).toBe(false);
    expect(existsSync(path.join(codexSkills, "user-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(claudeSkills, "mulmoterminal-dirs", "SKILL.md"))).toBe(true);
  });

  it("removes only the retired data MCP registration from every known config surface", () => {
    const home = tmp();
    const codexHome = path.join(home, "codex-home");
    const repo = path.join(home, "repo");
    const cwd = path.join(repo, "packages", "app");
    mkdirSync(cwd, { recursive: true });
    const claudeConfigFile = path.join(home, "claude-config", ".claude.json");
    writeJson(claudeConfigFile, {
      mcpServers: {
        "mulmoterminal-data": { type: "http", url: "http://127.0.0.1/api/mcp/data/${MULMOTERMINAL_SESSION_ID}" },
        "mulmoterminal-render": { type: "http", url: "http://127.0.0.1/api/mcp/render/${MULMOTERMINAL_SESSION_ID}" },
        theirs: { command: "server" },
      },
      projects: {
        [cwd]: {
          mcpServers: {
            "mulmoterminal-data": { type: "http" },
            "mulmoterminal-media": { type: "http" },
          },
        },
      },
    });
    writeJson(path.join(repo, ".mcp.json"), {
      mcpServers: {
        "mulmoterminal-data": { type: "http" },
        "mulmoterminal-external": { type: "http" },
      },
    });
    writeJson(path.join(cwd, ".agents", "mcp_config.json"), {
      mcpServers: {
        "mulmoterminal-data": { command: "old" },
        theirs: { command: "keep" },
      },
    });
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      path.join(codexHome, "config.toml"),
      [
        '[mcp_servers."mulmoterminal-data"]',
        'url = "http://127.0.0.1/api/mcp/data/${MULMOTERMINAL_SESSION_ID}"',
        "",
        "[mcp_servers.mulmoterminal-render]",
        'url = "http://127.0.0.1/api/mcp/render/${MULMOTERMINAL_SESSION_ID}"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runUpgradeCleanup({ home, codexHome, claudeConfigFile, knownDirs: [cwd] });

    expect(result).toMatchObject<Partial<UpgradeCleanupResult>>({ ownedSkillsRemoved: 0, mcpRegistrationsRemoved: 5 });
    const claude = readJson(claudeConfigFile);
    expect((claude.mcpServers as Record<string, unknown>)["mulmoterminal-data"]).toBeUndefined();
    expect((claude.mcpServers as Record<string, unknown>)["mulmoterminal-render"]).toBeDefined();
    expect((claude.mcpServers as Record<string, unknown>).theirs).toBeDefined();
    const project = (claude.projects as Record<string, { mcpServers: Record<string, unknown> }>)[cwd];
    expect(project.mcpServers["mulmoterminal-data"]).toBeUndefined();
    expect(project.mcpServers["mulmoterminal-media"]).toBeDefined();
    expect(readFileSync(path.join(repo, ".mcp.json"), "utf8")).not.toContain("mulmoterminal-data");
    expect(readJson(path.join(cwd, ".agents", "mcp_config.json")).mcpServers).toEqual({ theirs: { command: "keep" } });
    const codex = readFileSync(path.join(codexHome, "config.toml"), "utf8");
    expect(codex).not.toContain("mulmoterminal-data");
    expect(codex).toContain("[mcp_servers.mulmoterminal-render]");
  });
});

describe("removeRetiredCodexMcpTables", () => {
  it("removes only the retired table block", () => {
    const result = removeRetiredCodexMcpTables(
      ["[mcp_servers.mulmoterminal-data] # old", 'url = "http://127.0.0.1/api/mcp/data/s1"', "[mcp_servers.mulmoterminal-media]", 'url = "ok"'].join("\n"),
    );

    expect(result.removed).toBe(1);
    expect(result.text).not.toContain("mulmoterminal-data");
    expect(result.text).toContain("[mcp_servers.mulmoterminal-media]");
  });
});
