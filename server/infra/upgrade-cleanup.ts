import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isRecord } from "../../common/isRecord.js";
import { removeQuietly } from "./fs-cleanup.js";

const OWNED_SKILL_MARKER = ".mt-owned";
const CODEX_MIRROR_MARKER = ".mt-mirror";
const RETIRED_MCP_SERVER_IDS = ["mulmoterminal-data"] as const;
const RETIRED_MCP_SERVER_ID_SET = new Set<string>(RETIRED_MCP_SERVER_IDS);

export const RETIRED_MULMOTERMINAL_SKILL_NAMES = [
  "mulmoterminal-config",
  "mulmoterminal-dirs",
  "mulmoterminal-theme",
  "mulmoterminal-header",
  "mulmoterminal-keys",
  "mulmoterminal-model",
  "mulmoterminal-notify",
  "mulmoterminal-bug-report",
  "mulmoterminal-decisions",
] as const;

export interface UpgradeCleanupOptions {
  home?: string;
  codexHome?: string;
  claudeConfigFile?: string;
  knownDirs?: readonly string[];
}

export interface UpgradeCleanupResult {
  ownedSkillsRemoved: number;
  mcpRegistrationsRemoved: number;
  notificationsRemoved: number;
  filesChanged: number;
}

const emptyResult = (): UpgradeCleanupResult => ({
  ownedSkillsRemoved: 0,
  mcpRegistrationsRemoved: 0,
  notificationsRemoved: 0,
  filesChanged: 0,
});

export function defaultCodexHome(home = homedir()): string {
  return process.env.CODEX_HOME || path.join(home, ".codex");
}

export function defaultClaudeConfigFile(home = homedir()): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR?.trim() || home, ".claude.json");
}

export function retiredSkillRoots(home = homedir(), codexHome = defaultCodexHome(home)): string[] {
  return [path.join(home, ".claude", "skills"), path.join(codexHome, "skills")];
}

export function removeOwnedRetiredSkills(roots: readonly string[]): number {
  let removed = 0;
  for (const root of roots) {
    for (const name of RETIRED_MULMOTERMINAL_SKILL_NAMES) {
      const dir = path.join(root, name);
      if (!existsSync(path.join(dir, OWNED_SKILL_MARKER))) continue;
      if (removeQuietly(dir)) removed += 1;
    }
  }
  return removed;
}

function directoryNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function removeOwnedCodexSkillMirrors(codexSkillsRoot: string): number {
  let removed = 0;
  for (const name of directoryNames(codexSkillsRoot)) {
    const dir = path.join(codexSkillsRoot, name);
    if (!existsSync(path.join(dir, CODEX_MIRROR_MARKER))) continue;
    if (removeQuietly(dir)) removed += 1;
  }
  return removed;
}

const ownProp = (obj: unknown, key: string): unknown => (isRecord(obj) && Object.hasOwn(obj, key) ? obj[key] : undefined);

function removeServerIdsFromScope(scope: unknown): number {
  if (!isRecord(scope)) return 0;
  const servers = ownProp(scope, "mcpServers");
  if (!isRecord(servers)) return 0;
  const entries = Object.entries(servers);
  const kept = entries.filter(([id]) => !RETIRED_MCP_SERVER_ID_SET.has(id));
  const removed = entries.length - kept.length;
  if (removed > 0) scope.mcpServers = Object.fromEntries(kept);
  return removed;
}

export function removeRetiredClaudeMcpRegistrations(config: Record<string, unknown>): number {
  let removed = removeServerIdsFromScope(config);
  const projects = ownProp(config, "projects");
  if (!isRecord(projects)) return removed;
  for (const scope of Object.values(projects)) removed += removeServerIdsFromScope(scope);
  return removed;
}

export function removeRetiredMcpRegistrationsFromJsonText(text: string): { text: string; removed: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const removed = removeServerIdsFromScope(parsed);
  return removed === 0 ? { text, removed } : { text: JSON.stringify(parsed, null, 2) + "\n", removed };
}

function rewriteJsonConfig(file: string, mutate: (doc: Record<string, unknown>) => number): UpgradeCleanupResult {
  if (!existsSync(file)) return emptyResult();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return emptyResult();
  }
  if (!isRecord(parsed)) return emptyResult();
  const removed = mutate(parsed);
  if (removed === 0) return emptyResult();
  try {
    writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    return { ownedSkillsRemoved: 0, mcpRegistrationsRemoved: removed, notificationsRemoved: 0, filesChanged: 1 };
  } catch {
    return emptyResult();
  }
}

function retiredCollectionTarget(entry: Record<string, unknown>): boolean {
  if (typeof entry.navigateTarget === "string" && entry.navigateTarget.startsWith("/collections/")) return true;
  const pluginData = ownProp(entry, "pluginData");
  if (!isRecord(pluginData)) return false;
  if (pluginData.kind === "collection-completion") return true;
  const action = ownProp(pluginData, "action");
  const target = ownProp(action, "target");
  return isRecord(target) && target.view === "collections";
}

export function removeRetiredCollectionNotifications(activeFile: Record<string, unknown>): number {
  const entries = ownProp(activeFile, "entries");
  if (!isRecord(entries)) return 0;
  const pairs = Object.entries(entries);
  const kept = pairs.filter(([, entry]) => !isRecord(entry) || !retiredCollectionTarget(entry));
  const removed = pairs.length - kept.length;
  if (removed > 0) activeFile.entries = Object.fromEntries(kept);
  return removed;
}

function rewriteNotifierActiveFile(file: string): UpgradeCleanupResult {
  const result = rewriteJsonConfig(file, removeRetiredCollectionNotifications);
  return result.mcpRegistrationsRemoved === 0
    ? result
    : {
        ownedSkillsRemoved: 0,
        mcpRegistrationsRemoved: 0,
        notificationsRemoved: result.mcpRegistrationsRemoved,
        filesChanged: result.filesChanged,
      };
}

function isRetiredCodexMcpTable(line: string): boolean {
  const header = (line.trim().split("#", 1)[0] ?? "").trim();
  return header === "[mcp_servers.mulmoterminal-data]" || header === '[mcp_servers."mulmoterminal-data"]';
}

export function removeRetiredCodexMcpTables(text: string): { text: string; removed: number } {
  const lines = text.split("\n");
  const kept: string[] = [];
  let skipping = false;
  let removed = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (isRetiredCodexMcpTable(trimmed)) {
      skipping = true;
      removed += 1;
      continue;
    }
    if (skipping && line.trimStart().startsWith("[")) skipping = false;
    if (!skipping) kept.push(line);
  }
  return removed === 0 ? { text, removed } : { text: kept.join("\n"), removed };
}

function rewriteCodexConfig(file: string): UpgradeCleanupResult {
  if (!existsSync(file)) return emptyResult();
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return emptyResult();
  }
  const result = removeRetiredCodexMcpTables(content);
  if (result.removed === 0) return emptyResult();
  try {
    writeFileSync(file, result.text, "utf8");
    return { ownedSkillsRemoved: 0, mcpRegistrationsRemoved: result.removed, notificationsRemoved: 0, filesChanged: 1 };
  } catch {
    return emptyResult();
  }
}

function realpathOr(dir: string): string {
  try {
    return realpathSync.native(dir);
  } catch {
    return dir;
  }
}

function ancestorFiles(dirs: readonly string[], filename: string): string[] {
  const files = new Set<string>();
  for (const raw of dirs) {
    if (!raw) continue;
    for (const dir of new Set([raw, realpathOr(raw)])) {
      for (let current = dir, parent = path.dirname(current); ; current = parent, parent = path.dirname(current)) {
        files.add(path.join(current, filename));
        if (parent === current) break;
      }
    }
  }
  return [...files];
}

function workspaceFiles(dirs: readonly string[], filename: string): string[] {
  const files = new Set<string>();
  for (const raw of dirs) {
    if (!raw) continue;
    for (const dir of new Set([raw, realpathOr(raw)])) files.add(path.join(dir, filename));
  }
  return [...files];
}

function add(a: UpgradeCleanupResult, b: UpgradeCleanupResult): UpgradeCleanupResult {
  return {
    ownedSkillsRemoved: a.ownedSkillsRemoved + b.ownedSkillsRemoved,
    mcpRegistrationsRemoved: a.mcpRegistrationsRemoved + b.mcpRegistrationsRemoved,
    notificationsRemoved: a.notificationsRemoved + b.notificationsRemoved,
    filesChanged: a.filesChanged + b.filesChanged,
  };
}

export function runUpgradeCleanup(options: UpgradeCleanupOptions = {}): UpgradeCleanupResult {
  const home = options.home ?? homedir();
  const codexHome = options.codexHome ?? defaultCodexHome(home);
  let result = emptyResult();
  result.ownedSkillsRemoved = removeOwnedRetiredSkills(retiredSkillRoots(home, codexHome));
  result.ownedSkillsRemoved += removeOwnedCodexSkillMirrors(path.join(codexHome, "skills"));
  result = add(result, rewriteJsonConfig(options.claudeConfigFile ?? defaultClaudeConfigFile(home), removeRetiredClaudeMcpRegistrations));
  for (const file of ancestorFiles(options.knownDirs ?? [], ".mcp.json")) {
    result = add(result, rewriteJsonConfig(file, removeServerIdsFromScope));
  }
  for (const file of ancestorFiles(options.knownDirs ?? [], path.join(".agents", "mcp_config.json"))) {
    result = add(result, rewriteJsonConfig(file, removeServerIdsFromScope));
  }
  for (const file of workspaceFiles(options.knownDirs ?? [], path.join("data", "notifier", "active.json"))) {
    result = add(result, rewriteNotifierActiveFile(file));
  }
  result = add(result, rewriteCodexConfig(path.join(codexHome, "config.toml")));
  return result;
}
