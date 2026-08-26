// Starting a claude session in a PTY and wiring it to the browser. The most entangled
// piece of index.ts (#548 step 3c): it spans the CLI args, the
// Core metadata, the draft typed into the input box, and teardown on exit.
import type { WebSocket } from "ws";
import { CLAUDE_CWD, PORT, isWorkspaceCwd } from "../config/env.js";
import { guiMcpEnv } from "./mcp-config.js";
import { getUserMcpServers, getPrWorkdirFooter, getAppendSystemPrompt, getTerminalSubmit } from "../config/config-routes.js";
import { submitSequenceForAgent } from "../../common/terminalSubmit.js";
import { buildClaudeArgs } from "../agents/claude-args.js";
import { claudeAdapter } from "../agents/claude.js";
import { appendedSystemPrompt } from "../agents/appended-prompt.js";
import { hookedSessions, ptys, resetSessionToolGroups } from "./registry.js";
import { isCoreSessionExitEvent, ptySpawn, ptyWouldReattach } from "./pty-spawn.js";
import { ptyExitLine, ptyStartLine } from "./pty-exit-log.js";
import { attachDraftInjection } from "./draft-injection.js";
import { sendExitAndClose, sendFrame } from "./ws-frames.js";
import { appendBoundedOutput } from "./terminal-replay.js";
import { sessionExistsOnDisk } from "./session-reads.js";
import type { PtyEntry } from "./types.js";
import type { SpawnDeps } from "./spawn-deps.js";
import { loadDirConfig } from "../config/dir-config.js";
import { repoRootSync } from "../git/repo-root-sync.js";
import { workdirFooter } from "../git/pr-footer.js";
import { getProviders } from "../config/config-routes.js";
import { requireResolution, resolveProvider, type DirModelChoice } from "./provider-env.js";
import { settingsArgument, mcpConfigArgument, withSettingsCleanup } from "./session-settings.js";
import { ensureDropsDir } from "./session-drops.js";
import { effectiveChoice } from "./launch-choice.js";
import type { CoreSessionVisibility } from "./core-session-adapter.js";

function cleanupExitedCoreSession(deps: SpawnDeps, sessionId: string): void {
  deps.cleanupSessionResources(sessionId);
  deps.endSessionActivity(sessionId);
}

export interface SpawnClaudeOptions {
  // Passed to claude as the first turn, so the session starts working before anyone
  // opens it. Mutually exclusive with `draft`.
  initialPrompt?: string;
  cwd?: string;
  /** NOT a grid cell — the single view, or a chat spawned with no cell of its own yet. It is one
   *  of the two ways a session earns the full GUI MCP; the other is running in the workspace
   *  itself, which is derived from `cwd` rather than passed (see fullGuiMcp below). */
  attachGuiMcp?: boolean;
  // Typed into the input box once claude is ready, NOT submitted — the user reviews it.
  draft?: string;
  // What the browser picked in the launch form (#584). Replaces the directory's default
  // as a PAIR: a provider from one source with a model from the other is a combination
  // neither of them asked for. Absent — the usual case — means "use the directory's".
  launch?: DirModelChoice | undefined;
  /** This id is already a Core member; attach its pane instead of creating a session. */
  coreSessionExists?: boolean;
  visibility?: CoreSessionVisibility;
}

// The `work in <clone>` line for a session's PRs, or null when the footer is switched off or the
// directory is not a git repo (nothing to name).
//
// Resolved HERE rather than left to the agent: inside a managed worktree an agent would name the
// worktree, and the clone is what identifies the work (the branch is already on the PR). Read per
// spawn, like the ⧉ Open PR button reads it per PR, so switching it off needs no restart.
function sessionWorkdirFooter(cwd: string): string | null {
  if (!getPrWorkdirFooter()) return null;
  const root = repoRootSync(cwd);
  return root ? workdirFooter(root) : null;
}

// What `--append-system-prompt` carries for this session (#1062). Every source is read per spawn,
// so switching any section off needs no restart.
function sessionAppendedPrompt(cwd: string, dirSetting: boolean | null): string | null {
  return appendedSystemPrompt({ dirSetting, globalSetting: getAppendSystemPrompt(), workdirFooter: sessionWorkdirFooter(cwd) });
}

// The sidebar row a session gets before it has a transcript. A session spawned to run something
// (an initial prompt or a draft) is named after that text, so it is recognizable there before
// anyone opens it; anything else is just "New session".
function newSessionTitle(seed: string | undefined): string {
  return (seed ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "New session";
}

function relayClaudeOutput(entry: PtyEntry, data: string, deps: SpawnDeps): void {
  entry.buffer = appendBoundedOutput(entry.buffer, data, deps.outputBufferLimit);
  sendFrame(entry.ws, { type: "output", data });
}

// What this session runs, and the directory config it runs under (#579). A refusal THROWS:
// falling back to Anthropic would send this session's prompts to a backend the directory did not
// select, which is exactly what the provider contract exists to prevent. The ws route turns it
// into a message in the terminal.
//
// Its own function because the spawn body is at its line budget and this is one decision made
// from three sources, not part of spawning.
function resolveSessionBackend(input: { cwd: string; sessionId: string; launch?: DirModelChoice | undefined; canResume: boolean }) {
  const dir = loadDirConfig(input.cwd);
  const choice = effectiveChoice({
    launch: input.launch,
    dir: { provider: dir.provider, model: dir.model },
    resuming: input.canResume,
  });
  const resolved = requireResolution(resolveProvider(choice, getProviders(), process.env));
  // Remembered so a later resume continues on the backend this session began on, instead of
  // silently moving to the directory's default mid-conversation.
  return { dir, resolved };
}

/**
 * The directories this session may read outside its cwd. A file dropped into the session is saved
 * outside it, so the agent would meet a permission prompt on every Read without this. Granted at
 * spawn rather than per drop because `--add-dir` is a spawn-time flag: a session already running
 * cannot be given one later.
 *
 * Its own function for the same reason resolveSessionBackend is — the spawn body is at its line
 * budget, and this is a value derived from two sources rather than part of spawning.
 */
function sessionAddDirs(sessionId: string, configured: string[] | null | undefined): string[] | null | undefined {
  const dropsDirectory = ensureDropsDir(sessionId);
  return dropsDirectory ? [...(configured ?? []), dropsDirectory] : configured;
}

function sessionMcpConfig(deps: SpawnDeps, sessionId: string, fullGuiMcp: boolean): string {
  const json = deps.mcpConfigJson(sessionId, "127.0.0.1");
  return fullGuiMcp ? mcpConfigArgument(sessionId, json) : json;
}

/**
 * Does this session carry the WHOLE GUI MCP on `--mcp-config`, the way the single view always
 * has? Two ways to earn it, and they are different facts that used to be one flag:
 *
 *   `attachGuiMcp` — not a grid cell at all: the single view, or a chat spawned with no cell yet.
 *   the CWD        — a grid cell running in the workspace itself. Starting a terminal there is
 *                    all but the same thing as running the single view, and that equivalence is
 *                    what lets the single view eventually go.
 *
 * A cell in a PROJECT directory is false on both counts and takes exactly the branch it takes
 * today. Named and exported rather than left inline because that last sentence is the invariant
 * this whole change is written around, and an invariant nothing can assert is just a hope.
 */
export const carriesFullGuiMcp = (attachGuiMcp: boolean, cwd: string | undefined): boolean => attachGuiMcp || isWorkspaceCwd(cwd);

export function createClaudeSpawner(deps: SpawnDeps) {
  // `ws` may be null for a session spawned without a viewer; output buffers until attach.
  function spawnClaudePty(sessionId: string, resume: string | null, ws: WebSocket | null, options: SpawnClaudeOptions = {}): PtyEntry {
    const { initialPrompt, cwd = CLAUDE_CWD, attachGuiMcp = true, draft, launch, coreSessionExists = false, visibility = "normal" } = options;
    const fullGuiMcp = carriesFullGuiMcp(attachGuiMcp, cwd);
    // fullGuiMcp picks the MCP mode (see buildClaudeArgs, and its own doc for who earns it): the
    // GUI MCP + --strict-mcp-config; a project-directory cell attaches neither, so its own load.
    // Claude can resume only after its conversation exists on disk.
    const canResume = resume !== null && sessionExistsOnDisk(resume, cwd);
    const { dir, resolved } = resolveSessionBackend({ cwd, sessionId, launch, canResume });

    const hookSettings = deps.hookSettingsJson("localhost", sessionId, resolved.env);
    // File-ized only when it is actually passed (fullGuiMcp), so a cell that never carries
    // the GUI MCP leaves no file behind for reap to clean up.
    const args = buildClaudeArgs({
      model: resolved.model,
      sessionId,
      resume,
      canResume,
      // A provider session's settings carry its token, so they go to a 0600 file instead of
      // argv — see session-settings.ts.
      settings: settingsArgument(sessionId, hookSettings, Object.keys(resolved.env).length > 0),
      permissionMode: deps.permissionMode,
      attachGuiMcp: fullGuiMcp,
      mcpConfig: sessionMcpConfig(deps, sessionId, fullGuiMcp),
      // Carrying the whole GUI MCP: auto-allow the GUI tools + the user's own configured MCP
      // servers (mcp__<id>), so their tools don't trip a permission prompt on every call.
      // A project-directory cell: no --mcp-config at all, so there is nothing of ours to name —
      // except the tool GROUPS the directory may have registered itself, which we pre-approve
      // blind (see GRID_MCP_TOOLS). The user's own servers keep their normal prompts there, since
      // that path never went through our allowlist before.
      allowedTools: fullGuiMcp ? [deps.guiMcpTools, ...getUserMcpServers().map((s) => `mcp__${s.id}`)].join(",") : deps.gridMcpTools,
      addDirs: sessionAddDirs(sessionId, dir.addDirs),
      appendedPrompt: sessionAppendedPrompt(cwd, dir.appendSystemPrompt),
    });

    console.log(`[ws] client connected (${canResume ? "resume" : "new"} ${sessionId})`);

    // The settings file is already on disk and may hold a provider token, so a failed
    // spawn has to take it with it — a session that never starts never reaches reap(),
    // where the cleanup normally happens (#579).
    const entry = withSettingsCleanup(sessionId, spawnEntry);
    const spawnedAtMs = Date.now();

    // A NEW claude process gets whatever the user's MCP config says NOW, so anything this id
    // learned under a previous one is stale — including a group the user has since removed.
    //
    // But this function is also the REATTACH path: after the server restarts (a --watch reload
    // included), the pty map is empty while the tmux session and its claude are still running, so
    // ws-routes comes back through here and `new-session -A` picks the same process back up.
    // Nothing is re-read there, and an MCP client that connected once will not connect again — so
    // resetting would drop a capability with no way left to relearn it, and the panel would tell a
    // cell that is still drawing that Canvas is not enabled for it. Surviving exactly that is what
    // the persisted log is FOR; the unconditional reset was undoing it on every restart.
    function spawnEntry(): PtyEntry {
      if (!ptyWouldReattach(coreSessionExists, true)) resetSessionToolGroups(sessionId);
      const spawnEnv = {
        agent: "claude" as const,
        unset: resolved.unset,
        env: guiMcpEnv(sessionId, PORT),
        binEnvVar: claudeAdapter.binEnvVar,
        coreSessionExists,
        resumeSource: canResume ? resume : null,
        visibility,
        ...(!canResume ? { title: newSessionTitle(initialPrompt ?? draft) } : {}),
      };
      const { term, tmux, reattached } = ptySpawn(sessionId, deps.claudeBin, args, cwd, true, spawnEnv);
      console.log(ptyStartLine({ agent: "claude", pid: term.pid, cwd, tmux, reattached, sessionId, note: canResume ? `resume ${resume}` : null }));
      return { term, ws, buffer: "", cwd, tmux, active: false, agent: "claude" };
    }
    ptys.set(sessionId, entry);
    // Every spawn carries the hooks, so the MCP broker must not record its GUI calls again
    // (mcp/gui-call-history.ts).
    hookedSessions.add(sessionId);

    if (!canResume) deps.publishSessionCreated(sessionId);

    // The auto-run prompt / editable draft is typed into the input box once ready (see
    // attachDraftInjection) — its scanner is fed the pty output below. The submit byte(s)
    // are resolved per send, the same live config read and agent scoping the phone's submit
    // uses (index.ts) — an `esc-cr` host submits on ESC+CR, so a hardcoded CR would land as a
    // newline and the prompt would never run (#1148).
    const scanForDraftReady = attachDraftInjection(entry, initialPrompt, draft, () => submitSequenceForAgent(entry.agent, getTerminalSubmit()));

    // PTY -> browser (buffering a bounded tail for reattach).
    entry.term.onData((data) => {
      relayClaudeOutput(entry, data, deps);
      scanForDraftReady(data);
    });

    entry.term.onExit((event) => {
      const { exitCode, signal } = event;
      console.log(ptyExitLine({ agent: "claude", exitCode, signal, lifetimeMs: Date.now() - spawnedAtMs, cwd, sessionId }));
      if (isCoreSessionExitEvent(event)) cleanupExitedCoreSession(deps, sessionId);
      sendExitAndClose(entry.ws, exitCode, signal);
      // Clear the activity dot and release this process's viewer transport. Core membership
      // remains discoverable independently of transcript persistence.
      deps.releaseViewer(sessionId);
    });

    return entry;
  }

  return { spawnClaudePty };
}
