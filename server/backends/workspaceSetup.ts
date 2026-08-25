// Boot-time workspace seeding, shared with MulmoClaude via @mulmoclaude/core. On a
// MulmoTerminal-alone run the workspace would otherwise be empty: no help docs.
//
// Seeding is GATED to the managed mulmoclaude workspace (~/mulmoclaude, or
// MULMOCLAUDE_WORKSPACE_PATH). The launcher often runs the terminal in an arbitrary
// project directory (bin/mulmoterminal.js defaults CLAUDE_CWD to the cwd it ran
// from), and we must NOT write mulmoclaude helps there.
//
// Destinations match MulmoClaude's WORKSPACE_DIRS exactly so both apps share one
// on-disk layout:
//   <ws>/config/helps                 — seeded help docs
import path from "node:path";
import os from "node:os";
import { seedHelps } from "@mulmoclaude/core/workspace-setup";
import { isSamePath } from "../infra/path-within.js";

// Console-backed logger, matching the prefix style other backends use.
const log = {
  info: (message: string, data?: Record<string, unknown>) => console.log(`[workspace-setup] ${message}`, data ?? ""),
  warn: (message: string, data?: Record<string, unknown>) => console.warn(`[workspace-setup] ${message}`, data ?? ""),
  error: (message: string, data?: Record<string, unknown>) => console.error(`[workspace-setup] ${message}`, data ?? ""),
};

/** The managed mulmoclaude workspace: MULMOCLAUDE_WORKSPACE_PATH if set, else
 *  ~/mulmoclaude. */
function managedWorkspacePath(): string {
  return process.env.MULMOCLAUDE_WORKSPACE_PATH || path.join(os.homedir(), "mulmoclaude");
}

/** True only when `workspace` resolves to the managed mulmoclaude workspace. Seeding
 *  is confined to it so launching the terminal in an arbitrary project dir never
 *  writes mulmoclaude presets/helps there. */
export function isManagedWorkspace(workspace: string): boolean {
  // isSamePath, not `===`: the workspace arrives from the launcher's --cwd, so on Windows it
  // can name the managed directory in a different casing than os.homedir() spells it, and a
  // raw compare would silently skip seeding.
  return isSamePath(workspace, managedWorkspacePath());
}

// Run one seeding step in isolation: a filesystem edge case (EACCES/ENOSPC/path
// collision) must log and continue, never abort server startup or skip later steps.
function safeStep(label: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    log.error(`${label} failed — continuing`, { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Seed help docs into the workspace, but only when it is the
 *  managed mulmoclaude workspace. Each step is fault-isolated so a single FS failure
 *  cannot abort boot. */
export function initWorkspaceSetup(deps: { workspace: string }): void {
  const { workspace } = deps;
  if (!isManagedWorkspace(workspace)) {
    log.info("skipping seed — not the managed mulmoclaude workspace", { workspace });
    return;
  }

  safeStep("seedHelps", () => {
    const dest = path.join(workspace, "config", "helps");
    seedHelps({ destDir: dest });
    log.info("seeded help docs", { dest });
  });
}
