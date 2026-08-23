import { randomUUID } from "node:crypto";
import { messageOf } from "../errors.js";
import { registeredGuiMcpGroups } from "../infra/gui-mcp-registration.js";
import { markDevTerminalSession, markUnplacedSession } from "../session/registry.js";
import type { SpawnAntigravityPty, SpawnClaudePty, SpawnCodexPty, SpawnLauncherPty } from "../session/spawners.js";
import { claimLaunch, type WorktreeClaim, worktreeOccupancy } from "../session/worktree-session-limit.js";
import { SpawnRefusedError } from "../session/pty-spawn.js";
import { TOOL_GROUPS } from "../../common/toolGroups.js";
import { worktreeRefusal } from "../../common/worktreeSession.js";
import type { LaunchAgent } from "../../common/launchAgent.js";
import { recordSessionStarting, recordSessionStopped } from "../session/session-lifecycle-records.js";

export type LocalMobileTerminalCreateResult = { ok: true; sessionId: string } | { ok: false; error: string };

export interface LocalMobileTerminalCreatorDeps {
  spawnClaudePty: SpawnClaudePty;
  spawnCodexPty: SpawnCodexPty;
  spawnAntigravityPty: SpawnAntigravityPty;
  spawnLauncherPty: SpawnLauncherPty;
}

const DEFAULT_LAUNCH_CMD = process.env.SHELL || "/bin/sh";

const startError = (err: unknown): string => (err instanceof SpawnRefusedError ? err.message : messageOf(err));

async function worktreeLaunchRefusal(cwd: string, claim: WorktreeClaim): Promise<string | null> {
  const { isWorktree, session } = await worktreeOccupancy(cwd);
  return isWorktree ? worktreeRefusal(session, claim.contended) : null;
}

export function createLocalMobileTerminalCreator(deps: LocalMobileTerminalCreatorDeps) {
  return async (agent: LaunchAgent, cwd: string): Promise<LocalMobileTerminalCreateResult> => {
    const limited = agent !== "shell";
    const claim = limited ? claimLaunch(cwd) : null;
    let sessionId: string | null = null;
    let spawned = false;
    try {
      const refusal = claim ? await worktreeLaunchRefusal(cwd, claim) : null;
      if (refusal) return { ok: false, error: refusal };

      sessionId = randomUUID();
      recordSessionStarting({ id: sessionId, agent, cwd });
      if (agent === "shell") {
        deps.spawnLauncherPty(sessionId, null, DEFAULT_LAUNCH_CMD, cwd);
        spawned = true;
        markDevTerminalSession(sessionId, cwd);
        markUnplacedSession(sessionId, "shell");
      } else if (agent === "claude") {
        deps.spawnClaudePty(sessionId, null, null, { cwd, attachGuiMcp: false });
        spawned = true;
        markUnplacedSession(sessionId, agent);
      } else if (agent === "codex") {
        const groups = await registeredGuiMcpGroups(cwd, TOOL_GROUPS).catch(() => []);
        deps.spawnCodexPty(sessionId, null, null, cwd, false, { mcpGroups: groups });
        spawned = true;
        markUnplacedSession(sessionId, agent);
      } else {
        const groups = await registeredGuiMcpGroups(cwd, TOOL_GROUPS).catch(() => []);
        deps.spawnAntigravityPty(sessionId, null, null, cwd, { mcpGroups: groups });
        spawned = true;
        markUnplacedSession(sessionId, agent);
      }
      return { ok: true, sessionId };
    } catch (err) {
      if (sessionId && !spawned) recordSessionStopped({ id: sessionId, agent, cwd });
      return { ok: false, error: startError(err) };
    } finally {
      claim?.release();
    }
  };
}
