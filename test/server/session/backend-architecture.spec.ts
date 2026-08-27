// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sessionDir = path.join(root, "server", "session");

function typescriptSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return typescriptSources(target);
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  });
}

describe("backend session architecture", () => {
  it("has no backend lifecycle manager or reap policy module", () => {
    expect(existsSync(path.join(sessionDir, "lifecycle.ts"))).toBe(false);
    expect(existsSync(path.join(sessionDir, "reap-policy.ts"))).toBe(false);
  });

  it("does not wire removed lifecycle-manager operations into production", () => {
    const production = typescriptSources(path.join(root, "server"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    for (const removed of [
      "createSessionLifecycle",
      "cancelReap",
      "armReapForDetached",
      "cleanupManagedLiveSessions",
      "createLifecycleManager",
      "createCleanupManager",
      "reapSession",
    ]) {
      expect(production).not.toContain(removed);
    }
  });

  it("names the process-local transport registry viewerPtys and never ptys", () => {
    const production = typescriptSources(path.join(root, "server"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(production).toContain("viewerPtys");
    expect(production).not.toMatch(/\bptys\b/);
  });

  it("makes mobile membership a direct projection of Core sessions", () => {
    const source = readFileSync(path.join(root, "server", "mobileTerminal", "terminalScreen.ts"), "utf8");
    const listContract = source.slice(source.indexOf("export interface SessionListInput"), source.indexOf("// Live sessions first"));
    const builder = source.slice(source.indexOf("export function buildSessionList"), source.indexOf("// How much scrollback"));

    expect(listContract).toContain("sessions: readonly SessionListCoreSession[]");
    expect(listContract).not.toContain("viewerPtys");
    for (const alternativeIdSource of ["candidateIds", "liveIds", "tmuxIds", "history", "activity", "rollout", "transcript"]) {
      expect(listContract).not.toContain(alternativeIdSource);
      expect(builder).not.toContain(alternativeIdSource);
    }
    expect(builder).toContain("live: !exited");
    expect(builder).toContain("inputAvailable: !exited");
    expect(builder).not.toContain("viewerPtys");
  });

  it("never restores a missing Core screen from viewer replay state", () => {
    const source = readFileSync(path.join(root, "server", "mobileTerminal", "terminalScreen.ts"), "utf8");
    const capture = source.slice(source.indexOf("const screenRowsOf"), source.indexOf("// The metadata decorates"));
    expect(capture).toContain("throw new TerminalSessionNotFoundError(id)");
    for (const viewerFallback of ["sourceOf", "buffer", "render("]) expect(capture).not.toContain(viewerFallback);
  });

  it("does not infer Core agent metadata from pane commands", () => {
    const production = typescriptSources(path.join(root, "server"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(production).not.toContain("pane_current_command");
    expect(production).not.toContain("agentFromPaneCommand");
  });

  it("keeps explicit Delete's sole membership write at coreSessions.delete", () => {
    const source = readFileSync(path.join(root, "server", "index.ts"), "utf8");
    const deletion = source.slice(source.indexOf("async function deleteTerminalSession"), source.indexOf("// Seed help docs"));
    expect(deletion.match(/coreSessions\.delete\(id\)/g)).toHaveLength(1);
    expect(deletion).not.toContain("cleanupManager");
    expect(deletion).not.toContain("lifecycleManager");
  });
});
