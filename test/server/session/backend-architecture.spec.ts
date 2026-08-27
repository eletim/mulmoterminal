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

  it("has no generic backend session registry", () => {
    expect(existsSync(path.join(sessionDir, "registry.ts"))).toBe(false);
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

  it("keeps durable live capability and scheduler facts in Core metadata", () => {
    const core = readFileSync(path.join(sessionDir, "core-session-adapter.ts"), "utf8");
    expect(core).toContain('const GUI_TOOL_GROUPS_METADATA_KEY = "gui-tool-groups"');
    expect(core).toContain('const ALL_GUI_TOOLS_METADATA_KEY = "all-gui-tools"');
    expect(core).toContain('const ORIGIN_METADATA_KEY = "origin"');
    expect(core).toContain('const REPORTS_OWN_CALLS_METADATA_KEY = "reports-own-calls"');

    const production = typescriptSources(path.join(root, "server"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    for (const removed of [
      "hookedSessions",
      "userScheduledSessions",
      "codexRolloutIds",
      "claimedCodexRollouts",
      "claimedAntigravityConversations",
      "allToolsSessions",
      "activityStateHydrated",
    ]) {
      expect(production).not.toContain(removed);
    }
  });

  it("keeps viewer, activity, and history owners from writing Core membership or lifecycle", () => {
    for (const file of ["viewer-state.ts", "activity-store.ts", "history-state.ts", "history-memos.ts", "antigravity-history.ts"]) {
      const source = readFileSync(path.join(sessionDir, file), "utf8");
      expect(source).not.toContain("coreSessions.create");
      expect(source).not.toContain("coreSessions.delete");
      expect(source).not.toContain("coreSessions.stop");
      expect(source).not.toContain("coreSessions.list");
    }
  });

  it("does not persist activity across restart or revive Core lifecycle from UI state", () => {
    expect(existsSync(path.join(sessionDir, "activity-state.ts"))).toBe(false);
    const activity = readFileSync(path.join(sessionDir, "activity-store.ts"), "utf8");
    expect(activity).not.toContain("node:fs");
    expect(activity).not.toContain("MULMOTERMINAL_HOME");
    const routes = readFileSync(path.join(root, "server", "routes", "session-routes.ts"), "utf8");
    expect(routes).not.toContain("activityStateHydrated");
    expect(routes).toContain("workPhase: core?.exited ? null : workPhase");
  });

  it("uses retired capability logs only as one-way Core migration input", () => {
    const migration = readFileSync(path.join(sessionDir, "core-session-capability-migration.ts"), "utf8");
    expect(migration).toContain("learnGuiCapabilities");
    expect(migration).toContain("fs.rm");
    expect(migration).not.toContain("appendFile");
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

  it("keeps direct tmux helpers out of membership and native lifecycle authority", () => {
    const source = readFileSync(path.join(root, "server", "infra", "tmux.ts"), "utf8");
    expect(source).not.toContain("pane_current_command");
    expect(source).not.toContain("pane_dead");
    expect(source).not.toContain("kill-session");
    expect(source).not.toMatch(/export (async )?function tmux(SessionExists|Sessions|IsRunning|Exited)/);
  });

  it("keeps explicit Delete's sole membership write at coreSessions.delete", () => {
    const source = readFileSync(path.join(root, "server", "index.ts"), "utf8");
    const deletion = source.slice(source.indexOf("async function deleteTerminalSession"), source.indexOf("// Seed help docs"));
    expect(deletion.match(/coreSessions\.delete\(id\)/g)).toHaveLength(1);
    expect(deletion).not.toContain("cleanupManager");
    expect(deletion).not.toContain("lifecycleManager");
  });

  it("keeps Desktop Delete request/response and out of the viewer WebSocket protocol", () => {
    const route = readFileSync(path.join(root, "server", "routes", "terminal-delete-route.ts"), "utf8");
    expect(route).toContain('app.delete("/api/session/:id"');
    expect(route.indexOf("await deps.deleteSession(id)")).toBeLessThan(route.indexOf("res.json({ deleted: true })"));
    expect(route.indexOf("await deps.waitForPendingLaunch(id)")).toBeLessThan(route.indexOf("await deps.deleteSession(id)"));
    expect(route).not.toContain("activity");
    expect(existsSync(path.join(root, "server", "infra", "tmux-routes.ts"))).toBe(false);

    const viewer = readFileSync(path.join(sessionDir, "pty-connection.ts"), "utf8");
    expect(viewer).not.toContain('msg.type === "terminate"');
    expect(viewer).not.toContain("deleteSession:");
    expect(viewer).toContain("deps.releaseViewer(sessionId, entry)");
  });

  it("keeps deleting as frontend-only pending state and resets only after confirmed Delete", () => {
    const cell = readFileSync(path.join(root, "src", "components", "TerminalCell.vue"), "utf8");
    const request = cell.slice(cell.indexOf("async function requestCoreDelete"), cell.indexOf("async function removeAndClose"));
    expect(request).toContain('method: "DELETE"');
    expect(request).toContain("body.deleted !== true");
    expect(request).toContain("if (await requestCoreDelete()) resetAfterConfirmedDelete()");
    expect(request).not.toContain("terminate");

    const backend = typescriptSources(path.join(root, "server"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(backend).not.toMatch(/(?:const|let|var)\s+deleting\b/);
    expect(backend).not.toMatch(/\bdeleting\s*:/);
  });
});
