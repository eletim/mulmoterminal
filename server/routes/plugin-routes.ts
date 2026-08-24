// The GUI-plugin tool routes this server answers itself, rather than through a plugin
// package's own router.
//
// These MUST be mounted before mountAllRoutes' /api/plugin/:toolName catch-all, which would
// otherwise take them. Failures return a narrated 200 response so the MCP broker can hand the
// sentence back to the agent instead of throwing a tool-call transport error.
import { randomUUID } from "node:crypto";
import type { Express } from "express";

import { CLAUDE_CWD } from "../config/env.js";
import { messageOf } from "../errors.js";
import { backgroundMarkers, markFailedWorker, markUnplacedSession } from "../session/registry.js";
import { recordSessionStarting, recordSessionStopped } from "../session/session-lifecycle-records.js";
import { runWithHiddenMarker } from "../session/hiddenMarker.js";
import { registerCompletionHook } from "../session/completion-hooks.js";
import { backgroundChatMessage, parseBackgroundChat, spawnModeFor } from "../session/background-chat.js";
import { registeredGuiMcpGroups } from "../infra/gui-mcp-registration.js";
import { TOOL_GROUPS, type ToolGroup } from "../../common/toolGroups.js";
import type { SpawnClaudePty, SpawnCodexPty, SpawnAntigravityPty } from "../session/spawners.js";
import type { TerminalAgent } from "../../common/sessionAgent.js";

export interface PluginRouteDeps {
  spawnClaudePty: SpawnClaudePty;
  spawnCodexPty: SpawnCodexPty;
  spawnAntigravityPty: SpawnAntigravityPty;
  /** Put a hidden spawn on the scheduled-session retention (#541). Nobody watches a
   *  background worker and the chat list keeps it behind a filter, so the hook-driven reap
   *  is the only thing that would ever end it — and a worker blocked on a permission prompt
   *  never fires the hook that starts it. */
  registerBackgroundSession: (id: string) => void;
}

function spawnBackgroundChatSession(
  deps: PluginRouteDeps,
  sessionId: string,
  agent: TerminalAgent,
  draft: boolean,
  message: string,
  mcpGroups: readonly ToolGroup[],
): void {
  const mode = spawnModeFor(agent, draft);
  if (mode === "codex-run") deps.spawnCodexPty(sessionId, null, null, CLAUDE_CWD, true, { initialPrompt: message });
  else if (mode === "antigravity-run") deps.spawnAntigravityPty(sessionId, null, null, CLAUDE_CWD, { mcpGroups, initialPrompt: message });
  else if (mode === "claude-draft") deps.spawnClaudePty(sessionId, null, null, { draft: message });
  else deps.spawnClaudePty(sessionId, null, null, { initialPrompt: message });
}

export function mountPluginRoutes(app: Express, deps: PluginRouteDeps): void {
  // Host tool: spawnBackgroundChat. Unlike a plugin (handled by mountAllRoutes'
  // catch-all), it needs server internals — it spawns a brand-new interactive Claude
  // terminal session, seeded with `message`, that the user can open from the sidebar.
  // `role` is ignored (MulmoTerminal has no roles). `hidden:true` marks it a background
  // worker: it still lists in the sidebar, but behind the Background filter and never
  // bold/unread. `draft:true` makes `message` an editable DRAFT — typed into the input box
  // but NOT auto-submitted (the collection-plugin's startNewChatDraft / template cards),
  // so the user reviews and presses Enter.
  app.post("/api/plugin/spawnBackgroundChat", async (req, res) => {
    const parsed = parseBackgroundChat(req.body);
    if (!parsed.ok) return res.json({ message: parsed.message });
    const { agent, draft, hidden, message } = parsed.request;
    const sessionId = randomUUID();
    recordSessionStarting({ id: sessionId, agent, cwd: CLAUDE_CWD });
    // agy reads its GUI MCP servers from a file in the working directory, shared with every other
    // session there, so the groups have to be resolved BEFORE the spawn rewrites it — passing none
    // would clear the entries those sessions are using (#1095 review).
    const mcpGroups = agent === "antigravity" ? await registeredGuiMcpGroups(CLAUDE_CWD, TOOL_GROUPS).catch(() => []) : [];
    // ws is null: the session runs headless until the user opens it (reattach replays the buffered
    // output). A claude draft spawns with NO initial prompt (so it doesn't auto-run) and gets the text
    // typed into its input box. The other agents have no editable-draft path (no stable TUI
    // ready-marker), so their seed always auto-runs as a first-turn prompt on the command line —
    // codex positionally, agy through `--prompt-interactive`.
    let spawned = false;
    try {
      runWithHiddenMarker(hidden, sessionId, backgroundMarkers, () => spawnBackgroundChatSession(deps, sessionId, agent, draft, message, mcpGroups));
      spawned = true;
      // Visible: somebody should be able to SEE this session. The browser that asked for it
      // places it immediately (useChatLauncher), and this covers every other caller — an agent
      // calling the tool from another session, with no tab open at all. The mark is cleared the
      // moment any cell attaches, so the browser-placed case does not come back as a duplicate.
      if (!hidden) markUnplacedSession(sessionId, agent, CLAUDE_CWD);
      if (hidden) {
        deps.registerBackgroundSession(sessionId);
        // A hidden worker is invisible on purpose, which is exactly why a FAILED one needs a
        // record: nothing pulls the user's attention and nothing waits to be clicked, so the
        // failure is otherwise never learned. The completion hook is the existing seam for it —
        // a finished turn reports success first and this never fires; reaching teardown with no
        // Stop means no turn ever completed (see completion-hooks.ts for why first-answer-wins).
        //
        // Registered AFTER the spawn: a launch that threw has no session to report on, and would
        // leave a hook nothing will ever fire or clear. Safe against the feeds engine's own hook
        // (last writer wins) because that dispatches through its own spawner, never this route.
        //
        // CLAUDE ONLY, and that is a correctness limit rather than a scope choice. The single
        // success signal a PTY-hosted agent gives us is a finished turn reported by Claude Code's
        // Stop hook (hook-routes.ts); codex and antigravity have no hook mechanism at all, so
        // they can never report success. Registering for them would mean every SUCCESSFUL hidden
        // codex worker reached reap unreported and was marked failed — a signal that is wrong
        // more often than it is right, which is worse than the silence it replaced.
        // (Codex, PR #1188.) A non-claude hidden worker therefore keeps today's behaviour: no
        // failure signal. Giving it one needs a completion signal for those agents first.
        //
        // RECORDS ONLY, and synchronously. Announcing is reap's job: it publishes one teardown
        // message carrying this outcome, which is what keeps the generic notification from
        // racing ahead of the specific one. Staying synchronous is therefore a contract, not an
        // implementation detail — reap reads the flag immediately after firing this.
        if (agent === "claude") {
          registerCompletionHook(sessionId, ({ didError }) => {
            if (didError) markFailedWorker(sessionId);
          });
        }
      }
    } catch (err) {
      if (!spawned) recordSessionStopped({ id: sessionId, agent, cwd: CLAUDE_CWD });
      console.error(`[spawnBackgroundChat] failed for ${sessionId}: ${messageOf(err)}`);
      return res.json({ message: `Failed to spawn a new session: ${messageOf(err)}` });
    }
    return res.json({ message: backgroundChatMessage(agent, draft, sessionId), jsonData: { chatId: sessionId, agent } });
  });
}
