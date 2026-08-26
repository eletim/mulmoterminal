import express from "express";
import http from "http";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { createPubSub } from "./infra/pubsub.js";
import { hideErrorStacks } from "./infra/hide-error-stacks.js";
import { toolSummaries } from "./infra/plugins-registry.js";
import { initMarkdownBackend } from "./backends/markdown.js";
import { initArtifactsBackend } from "./backends/artifacts.js";
import { initOpenPathBackend } from "./backends/openPath.js";
import { getUserMcpServers, getTerminalSubmit, getQuickCommands, getCwdPresets, APP_CONFIG_FILE } from "./config/config-routes.js";
import { enforceKeymap } from "./config/keymap-check.js";
import { readFileSync } from "node:fs";
import { submitSequenceForAgent } from "../common/terminalSubmit.js";
import { sessionDisplayName } from "../common/sessionMemo.js";
import { refreshUpdateStatus } from "./config/update-status.js";
import { tmuxAvailable, tmuxAttachedClientCount, tmuxCaptureStyledPane, tmuxTerminalModes, tmuxRedrawClient, tmuxWindowSize } from "./infra/tmux.js";
import { bindSecurityWarning, browserOriginHostnames, createIsAllowedOrigin } from "./infra/allowed-origin.js";
import { serverErrorExit } from "./infra/server-exit.js";
import { PORT, BIND_HOST, CLAUDE_CWD, MULMOTERMINAL_HOME, SESSION_ID_RE, MULMOTERMINAL_BASE_PATH } from "./config/env.js";
import { isLoopbackBinding } from "./infra/loopback.js";
import { messageOf } from "./errors.js";
import { hookSettingsJson } from "./session/hook-settings.js";
import { mcpConfigJson } from "./session/mcp-config.js";
import { createClaudeSpawner } from "./session/spawn-claude.js";
import { spawnPty } from "./session/pty-spawn.js";
import { createRateLimitStore } from "./agents/rate-limit-store.js";
import { startRateLimitProbe } from "./agents/rate-limit-probe.js";
import { hasBinary } from "./infra/has-binary.js";
import { newProbeSessionId } from "./agents/probe-session.js";
import { writeProbeScreen } from "./agents/probe-stall.js";
import { removeProbeTranscript, sweepLegacyProbeTranscriptsOnce } from "./agents/probe-transcript.js";
import { removeLegacySandboxCredentials, removeLegacySandboxContainers } from "./infra/fs-cleanup.js";
import { runUpgradeCleanup } from "./infra/upgrade-cleanup.js";
import { newestRolloutFile, codexSessionsDir, readRolloutTail } from "./agents/codex-rollout.js";
import { latestRateLimitsInRollout } from "./agents/codex-rate-limits.js";
import { rateLimitCacheFile, readRateLimitCache, createRateLimitCacheWriter } from "./agents/rate-limit-persist.js";
import { createCodexSpawner } from "./session/spawn-codex.js";
import { createShellSpawners } from "./session/spawn-shell.js";
import { createTranslationWorker } from "./session/translation-worker.js";
import { createTitleManager } from "./session/session-title.js";
import { generateTitleFromTurns } from "./config/header-title.js";
import { mountTerminalWebSockets } from "./routes/ws-routes.js";
import { createConnectionHandlers } from "./session/pty-connection.js";
import { createTmuxSizeSync } from "./session/tmux-size-sync.js";
import type { SpawnDeps } from "./session/spawn-deps.js";
import { activity, lastPrompts, migrateHistoryMemosToCore, ptys } from "./session/registry.js";
import { hydrateClearedTranscripts } from "./session/cleared-transcripts.js";
import { spawnScheduledWorker } from "./session/scheduled-chat.js";
import { createToolStores } from "./session/tool-store.js";
import { createScheduledSessionRegistry, scheduledSessionInUse, scheduledSessionsDir } from "./session/scheduled-sessions.js";
import { claudeAdapter } from "./agents/claude.js";
import { codexAdapter } from "./agents/codex.js";
import { antigravityAdapter } from "./agents/antigravity.js";
import { createAntigravitySpawner } from "./session/spawn-antigravity.js";
import { renderAnsiRows } from "./session/headlessScreen.js";
import { ansiScreenWindow, parseAnsiRows } from "./session/ansiSegments.js";
import type { AnsiRow } from "../common/ansiStyle.js";
import {
  SCREEN_HISTORY_ROWS,
  buildScreenMeta,
  buildSessionList,
  coreTerminalScreen,
  type SessionDetailDraft,
  sessionWorkSummary,
  TerminalSessionNotFoundError,
  type SessionScreenMeta,
  type SessionWorkSummary,
} from "./mobileTerminal/terminalScreen.js";
import type { SessionAgent } from "../common/sessionAgent.js";
import { quickCommandsForAgent } from "./mobileTerminal/quickCommands.js";
import { createLaunchTerminalPublisher } from "./mobileTerminal/launchTerminalPublisher.js";
import { createLocalMobileTerminalCreator } from "./mobileTerminal/localMobileTerminalLauncher.js";
import { currentBranch, gitStatus } from "./git/git-status.js";
import { phaseForRepoBranch } from "./git/prPhase.js";
import { repoForDir } from "./git/forge-support.js";
import { resolveGithubUrl } from "./git/gitRemote.js";
import { canClearInputBox } from "./mobileTerminal/terminalInput.js";
import { createCoreSessionOperations } from "./mobileTerminal/coreSessionOperations.js";
import { initGoogleBackend } from "./backends/google.js";
import { initPluginRuntime } from "./infra/pluginRuntime.js";
import { createMobileWebPushFeature, mobileWebPushActivityLifecycleDeps } from "./mobile-web-push/feature.js";
import { normalizeActivity } from "./session/activity-transition.js";
import { mountConfiguredMobileTransport } from "./mobileTerminalTransport.js";
import { createWorkPhaseTracker } from "./session/work-phase-tracker.js";
import { initWorkspaceSetup } from "./backends/workspaceSetup.js";
import { initFileChangePublisher } from "./backends/fileChange.js";
import { initNotifier } from "./backends/notifier.js";
import { stopWhisperSidecar } from "./backends/whisper.js";
import { initUserTaskScheduler } from "./backends/scheduler.js";
import { initMulmoScriptBackend } from "./backends/mulmoscript.js";
import { createSessionLifecycle, SESSIONS_CHANNEL } from "./session/lifecycle.js";
import { mountAppRoutes } from "./routes/app-routes.js";
import { allowedToolNames, autoAllowedToolNames } from "./infra/plugins-registry.js";
import { installProcessGuards } from "./infra/process-guards.js";
import { pruneOrphanSettings } from "./session/session-settings.js";
import { earliestStartedAt, liveInstances, registerInstance } from "../bin/instances.js";
import { pruneOrphanDrops } from "./session/session-drops.js";
import { installGracefulShutdown } from "./infra/graceful-shutdown.js";
import { createInputReadinessTracker } from "./session/input-readiness.js";
import { mountOrchestratorSessionRoutes } from "./routes/orchestrator-session-routes.js";
import { coreSessions, CoreSessionNotFoundError } from "./session/core-session-adapter.js";
import { migrateLegacyBackgroundVisibility, visibleCoreSessions } from "./session/core-session-visibility.js";

// Register the top-level uncaughtException/unhandledRejection guards before any async boot
// work runs, so a single unhandled error can't silently kill the backend and disconnect
// every terminal at once (see infra/process-guards.ts).
installProcessGuards();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLAUDE_BIN = claudeAdapter.bin();
const CODEX_BIN = codexAdapter.bin();
const ANTIGRAVITY_BIN = antigravityAdapter.bin();
// Model override for codex sessions (--model); null uses codex's own configured default.
const CODEX_MODEL = process.env.CODEX_MODEL || null;
const ANTIGRAVITY_MODEL = process.env.ANTIGRAVITY_MODEL || null;
// Permission mode for backend-spawned Claude sessions. Defaults to "auto" so
// the backend runs hands-off; override with CLAUDE_PERMISSION_MODE (e.g.
// "default" / "acceptEdits" / "bypassPermissions" / "plan") when needed.
const CLAUDE_PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE || "auto";

// A direct `tsx server/index.ts` launch bypasses bin/mulmoterminal.js's preflight. Do not bind a
// healthy-looking server whose every terminal launch is guaranteed to fail: Core's dedicated tmux
// server is the sole session authority, not an optional persistence enhancement.
if (!tmuxAvailable()) {
  console.error("tmux not found. MulmoTerminal requires tmux (Windows users: run inside WSL).");
  process.exit(1);
}

// CLAUDE_CWD is the workspace used as the PTY cwd and as the root for persisted
// session state, so it must exist before we spawn anything into it.
await fs.mkdir(CLAUDE_CWD, { recursive: true });

const migratedBackgroundSessions = await migrateLegacyBackgroundVisibility(coreSessions).catch((error) => {
  console.warn(`[upgrade] could not migrate background visibility: ${messageOf(error)}`);
  return 0;
});
if (migratedBackgroundSessions > 0) {
  console.log(`[upgrade] migrated ${migratedBackgroundSessions} background session classification(s) to Core metadata`);
}

// One-way upgrade of the old history memo store for sessions that still have Core membership.
// Request paths never fall back to this store for live sessions after startup.
await migrateHistoryMemosToCore(await coreSessions.list(), (id, memo) => coreSessions.setMemo(id, memo));

// Seed help docs so a MulmoTerminal-alone run gets the basic workspace docs.
// Gated to the managed mulmoclaude workspace and
// fault-isolated per step, so it never aborts boot (see workspaceSetup.ts).
initWorkspaceSetup({ workspace: CLAUDE_CWD });

const upgradeCleanup = runUpgradeCleanup({ knownDirs: [CLAUDE_CWD, ...getCwdPresets().map((preset) => preset.path)] });
if (upgradeCleanup.ownedSkillsRemoved > 0 || upgradeCleanup.mcpRegistrationsRemoved > 0 || upgradeCleanup.notificationsRemoved > 0) {
  console.log(
    `[cleanup] removed ${upgradeCleanup.ownedSkillsRemoved} retired skill(s), ${upgradeCleanup.mcpRegistrationsRemoved} retired MCP registration(s), and ${upgradeCleanup.notificationsRemoved} retired notification(s)`,
  );
}

// Pub/sub channel the sidebar subscribes to for live session-activity changes.

// Pub/sub channel telling the client a directory's .mulmoterminal.json changed, so it re-reads that
// dir's config and recolours its cells without a page reload. Fed by the tool hooks, not a watcher.

// Per-session pub/sub channel the GUI panel subscribes to. The MCP broker POSTs a
// toolResult to /api/agent/toolResult, which stores it keyed by session id and
// publishes it here (mirrors MulmoClaude's sessionChannel; see the spike doc).
const sessionChannel = (id: string) => `session:${id}`;

// The GUI MCP server is served in-process over Streamable HTTP at /api/mcp/:sessionId
// (see the route below) and wired into each spawned claude via --mcp-config. It
// exposes one GUI-protocol tool per enabled plugin (driven by plugins/plugins.json)
// and drives the GUI panel via the toolResult route.

// MCP tool names claude uses, in the mcp__<server>__<tool> form, one per enabled
// plugin. Auto-allowed via --allowedTools so the spike doesn't trip the permission
// prompt (permissions stay terminal-native). Comma-joined into one --allowedTools.
// The worker-only `submitTranslation` tool is allowed for every session (harmless —
// only hidden translation workers are actually shown it, see the /mcp route) so the
// worker can call it without a permission prompt.
const GUI_MCP_TOOLS = [...allowedToolNames(), "mcp__mulmoterminal-gui__submitTranslation"].join(",");

// What a GRID cell pre-approves. A grid cell is never handed --mcp-config: its GUI tools come
// from the user's OWN per-folder MCP config (`claude mcp add -s local`, `.mcp.json`), so
// MulmoTerminal cannot know which groups a directory registered — and does not need to. It
// names the auto-allowed groups unconditionally; entries for a server the session didn't
// register match nothing. Only `render` is here: it cannot act outside the Canvas panel, so
// running it without a prompt is the point. Every other group keeps Claude Code's own prompt.
const GRID_MCP_TOOLS = autoAllowedToolNames().join(",");

// The panel's per-session stores. `publish` is a closure rather than the pubsub object
// because pub/sub only exists once the HTTP server does, and these are built before it.
const toolStores = createToolStores({
  publish: (channel, data) => pubsub?.publish(channel, data),
});

// Bytes of recent output kept per pty and replayed when a client reattaches to
// a background session, so the user sees context instead of a blank screen. On
// reattach the client resets its terminal and rebuilds scrollback purely from
// this replay, so this — not xterm's 1000-line scrollback — is what caps how far
// back you can scroll after a reload. 64 KiB of escape-heavy TUI output rendered
// to only ~100 lines; size it to comfortably fill the client's ~1000-line
// scrollback (older lines past that are dropped client-side anyway).
const OUTPUT_BUFFER_LIMIT = 1024 * 1024;

// Assigned once the HTTP server exists (createPubSub needs it).
let pubsub: ReturnType<typeof createPubSub> | null = null;

// Tear down a session's PTY and bookkeeping, then notify subscribers. The
// `activity` entry is dropped too — UNLESS it still carries `waiting`, which is
// what keeps a finished/needs-attention background session bold (via its
// on-disk record) until the user opens it. This keeps `activity` from growing
// unbounded while preserving the bold-until-viewed behavior.

// Keeps tmux's window in step with the browser's terminal, which SIGWINCH alone does not
// guarantee (session/tmux-size-sync.ts, #957).
const tmuxSizeSync = createTmuxSizeSync({
  windowSizeOf: (id) => tmuxWindowSize(id),
  resizePty: (id, { cols, rows }) => {
    try {
      ptys.get(id)?.term.resize(cols, rows);
    } catch (err) {
      // The pty exited between the probe and the repair — the screen it would have fixed is gone.
      console.warn(`[tmux-size] ${id}: resize dropped: ${messageOf(err)}`);
    }
  },
  onEvent: (event) => {
    const { id, wanted, seen } = event;
    const gap = `tmux window ${seen.cols}x${seen.rows}, client ${wanted.cols}x${wanted.rows}`;
    if (event.kind === "repairing") console.warn(`[tmux-size] ${id}: ${gap} — forcing a resize (#957)`);
    else console.warn(`[tmux-size] ${id}: ${gap} AFTER the forced resize — the window did not follow (#957)`);
  },
});

// Per-connection plumbing (session/pty-connection.ts). The reap decisions stay here —
// they read activity state and schedule timers that outlive any one connection.
const { reattachPty, handleClientFrame, handleClientClose } = createConnectionHandlers({
  cancelReap: (id) => cancelReap(id),
  deleteSession: (id) => coreSessions.delete(id),
  input: (id, data) => coreSessions.input(id, data),
  resize: async (id, cols, rows) => {
    ptys.get(id)?.term.resize(cols, rows);
    await coreSessions.resize(id, cols, rows);
  },
  setWaiting: (id, waiting) => setWaiting(id, waiting),
  armReapForDetached: (id) => armReapForDetached(id),
  terminalModesOf: (id) => tmuxTerminalModes(id),
  redrawTerminal: (id, clientPid) => tmuxRedrawClient(id, clientPid),
  checkTerminalSize: (id, size) => tmuxSizeSync.requestCheck(id, size),
  recheckTerminalSize: (id) => tmuxSizeSync.requestCheck(id),
  cancelTerminalSizeCheck: (id) => tmuxSizeSync.cancel(id),
  currentEntryOf: (id) => ptys.get(id),
});

const mobileWebPush = createMobileWebPushFeature(MULMOTERMINAL_HOME);
const mobileWebPushActivityDeps = mobileWebPushActivityLifecycleDeps({ sender: mobileWebPush.sender });

// Session teardown + activity publishing (session/lifecycle.ts).
const workPhaseTracker = createWorkPhaseTracker();

const lifecycle = createSessionLifecycle({
  publish: (channel, data) => pubsub?.publish(channel, data),
  forgetWorkPhase: (id) => workPhaseTracker.forget(id),
  forgetTerminalSize: (id) => tmuxSizeSync.forget(id),
  ...mobileWebPushActivityDeps,
});
const { cancelReap, reap, armReapForDetached, publishActivity, acknowledgeShellDone, setWorking, setWaiting } = lifecycle;
const inputReadiness = createInputReadinessTracker();

// AI-title bookkeeping (session/session-title.ts). publishActivity stays here — it
// publishes the whole session row, of which the title is one field.
const { forgetTitle, noteTitleTurn, maybeGenerateTitle, freshenRosterTitle } = createTitleManager({
  publishTitle: (id, title) => pubsub?.publish(SESSIONS_CHANNEL, { id, aiTitle: title }),
  now: () => Date.now(),
  generateTitle: (turns) => generateTitleFromTurns(turns),
  hasTitle: async (id) => !!(await coreSessions.find(id))?.title,
  persistTitle: async (id, title) => {
    try {
      await coreSessions.setTitle(id, title);
      return true;
    } catch (error) {
      if (error instanceof CoreSessionNotFoundError) return false;
      throw error;
    }
  },
  clearTitle: async (id) => {
    try {
      await coreSessions.setTitle(id, "");
    } catch (error) {
      if (!(error instanceof CoreSessionNotFoundError)) throw error;
    }
  },
});

// The PTY spawners (session/spawn-*.ts). They take what index.ts still owns — the session
// lifecycle it drives, and this file's port and live user config bound into the two payload
// builders (session/hook-settings.ts, session/mcp-config.ts) — as deps.
const spawnDeps: SpawnDeps = {
  claudeBin: CLAUDE_BIN,
  codexBin: CODEX_BIN,
  codexModel: CODEX_MODEL,
  antigravityBin: ANTIGRAVITY_BIN,
  antigravityModel: ANTIGRAVITY_MODEL,
  permissionMode: CLAUDE_PERMISSION_MODE,
  guiMcpTools: GUI_MCP_TOOLS,
  gridMcpTools: GRID_MCP_TOOLS,
  outputBufferLimit: OUTPUT_BUFFER_LIMIT,
  hookSettingsJson: (host, sessionId, env) => hookSettingsJson({ host, port: PORT, sessionId, env }),
  // The user's MCP servers are read per spawn, so a settings edit applies to the next session.
  mcpConfigJson: (sessionId, host) => mcpConfigJson({ sessionId, host, port: PORT, userMcpServers: getUserMcpServers() }),
  reap: (id) => reap(id),
  setWorking: (id, working, event) => setWorking(id, working, event),
  setWaiting: (id, waiting, event) => setWaiting(id, waiting, event),
  publishActivity: (id) => publishActivity(id),
  uiPort: String(process.env.CLIENT_PORT || PORT),
  publishSessionCreated: (sessionId) => {
    pubsub?.publish(SESSIONS_CHANNEL, { id: sessionId, working: false, event: "created" });
  },
  inputReadiness,
};
const { spawnClaudePty } = createClaudeSpawner(spawnDeps);
const { spawnCodexPty } = createCodexSpawner(spawnDeps);
const { spawnAntigravityPty } = createAntigravitySpawner(spawnDeps);
const { spawnCommandPty, spawnLauncherPty, resolveLauncher } = createShellSpawners(spawnDeps);

// The hidden translation worker (session/translation-worker.ts). It drives a headless
// claude session, so it needs the spawner above and the reap this file owns.
const { translateViaHiddenChat } = createTranslationWorker({
  reap: (id) => reap(id),
  deleteSession: async (id) => {
    try {
      await coreSessions.delete(id);
    } catch (error) {
      // A launch can fail before Core creates the session, while cleanup must stay idempotent.
      if (!(error instanceof CoreSessionNotFoundError)) throw error;
    }
  },
  spawnHiddenChat: (sessionId, prompt, visibility) => {
    // ws=null → headless; the worker buffers output nobody reads. Default cwd = CLAUDE_CWD (trusted).
    spawnClaudePty(sessionId, null, null, { initialPrompt: prompt, visibility });
  },
});

// Before anything binds a port: a typo'd key binding must stop the boot with a message
// naming it, not disappear into a shortcut that silently never fires.
enforceKeymap(APP_CONFIG_FILE, {
  readConfig: (): unknown => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(APP_CONFIG_FILE, "utf8"));
      return parsed;
    } catch {
      return undefined; // missing or unparseable — not this check's business to report
    }
  },
  warn: (message) => console.warn(`\x1b[33m${message}\x1b[0m`),
  fail: (message) => {
    console.error(`\x1b[31m${message}\x1b[0m`);
    process.exit(1);
  },
});

// Which browser origins this server accepts, decided once from what the operator asked for
// (#956). Read here rather than inside the predicate so the same set is what the startup warning
// reports — a warning describing a different rule than the one enforced is worse than none.
const browserHostnames = browserOriginHostnames(BIND_HOST, process.env.MULMOTERMINAL_ALLOWED_ORIGINS);
const isAllowedOrigin = createIsAllowedOrigin(browserHostnames);

// The 5h / 7d rate-limit gauge (#387). Codex is free — its rollout file holds the windows — while
// Claude needs a hidden probe session, so the store decides when spending a query is warranted.
// Neither agent being installed is not a case to handle: no rollout means no Codex reading, and a
// probe that cannot launch simply never reports, which is the same as having no data yet.
// Seeded from the last run so the header has numbers the moment the grid opens. Probing at boot
// instead would spend a query on every restart — once per SAVE under `yarn dev`.
// Stopping the probe the moment its answer lands. Without this the PTY was held for the full
// PROBE_TIMEOUT_MS — the status line arrives in seconds, so most of that minute and a half was a
// live `claude` process with nothing left to say, and `probing: true` kept every browser polling at
// seconds rather than minutes for the whole of it.
//
// Only a report carrying WINDOWS ends it. The status line also fires before the first API response,
// when `rate_limits` is not there yet (see statusline.ts) — stopping on that would kill the probe
// just before the thing it was spawned to collect.
let stopClaudeRateLimitProbe: (() => void) | null = null;

const writeRateLimitCacheIfChanged = createRateLimitCacheWriter(rateLimitCacheFile());
const rateLimitStore = createRateLimitStore(readRateLimitCache(rateLimitCacheFile()), (snapshot, agent) => {
  writeRateLimitCacheIfChanged(snapshot);
  if (agent === "claude") stopClaudeRateLimitProbe?.();
});
const refreshCodexRateLimits = (): void => {
  const file = newestRolloutFile(codexSessionsDir(), Date.now());
  if (file) rateLimitStore.reportCodex(latestRateLimitsInRollout(readRolloutTail(file)), Date.now());
};
// Whether a probe could even run. Checked before spawning rather than discovered by spawning
// (#1011): a machine without `claude` used to fail so fast that it never reached the 90s timeout,
// so the store learned nothing and the next poll tried again — a spawn attempt per poll.
const claudeIsRunnable = (): boolean => {
  try {
    return hasBinary(CLAUDE_BIN);
  } catch {
    return false;
  }
};

// Long enough for claude's own final write to land after the PTY is killed. Deleting into that
// window loses the race and the file comes back — and a transcript that reappears reads exactly
// like the bug this fixes (#1010).
const TRANSCRIPT_FLUSH_MS = 5_000;

// A probe that stopped for a reason nothing here can name. The screen is the only evidence there
// is, and without it the next report of "usage says n/a" starts from nothing (#1293).
const reportProbeScreen = (screen: string): void => {
  if (!screen) return;
  const file = writeProbeScreen(MULMOTERMINAL_HOME, screen);
  if (file) console.warn(`[rate-limit] the usage probe reported nothing; what its terminal showed is in ${file}`);
};

const startClaudeRateLimitProbe = (): void => {
  // Belt and braces: the route has already refused to want a probe when claude is missing, but
  // this is the last point before a spawn and the flag it would strand is set by the caller.
  if (!claudeIsRunnable()) {
    rateLimitStore.setClaudeAvailable(false);
    rateLimitStore.setProbeInFlight(false);
    return;
  }
  rateLimitStore.noteProbeStarted(Date.now());
  const sessionId = newProbeSessionId();
  stopClaudeRateLimitProbe = startRateLimitProbe({
    spawn: (args, cwd) => spawnPty(CLAUDE_BIN, args, cwd),
    host: "localhost",
    port: PORT,
    cwd: CLAUDE_CWD,
    sessionId,
    // A probe that settles WITHOUT the status line having reported is the "asked, heard nothing"
    // case. report() has already moved the state on if anything arrived, so this only widens the
    // gap when nothing did.
    onSettled: ({ stall, screen }) => {
      // Cleared here rather than by whoever called stop(): `stop()` is idempotent, but a stale
      // reference would let the NEXT probe be killed by a late report belonging to this one.
      stopClaudeRateLimitProbe = null;
      // Only a probe that failed for a reason we cannot name leaves its screen behind — a named one
      // is already on the gauge, and a successful one has nothing to explain (#1293).
      if (rateLimitStore.noteProbeFailedIfNoReport(Date.now(), stall) && stall === "unknown") reportProbeScreen(screen);
      rateLimitStore.setProbeInFlight(false);
      // Hiding it from /api/sessions is not enough: `claude --resume` reads the transcript
      // directory itself, so the probe has to take its own file with it (#1010).
      setTimeout(() => void removeProbeTranscript(CLAUDE_CWD, sessionId).catch(() => {}), TRANSCRIPT_FLUSH_MS).unref();
    },
  });
};

// Probes that ran before their ids identified them left transcripts nothing can address by name —
// 41 of one reporter's 50 listed sessions (#1010). Swept ONCE on this machine, never again: the
// content test cannot tell those files from a person who typed the probe's exact words, so the
// window in which that matters is closed rather than reopened on every boot (Codex review on
// #1030). It also means a 500MB transcript directory is read once, not once per `yarn dev` save.
void sweepLegacyProbeTranscriptsOnce(CLAUDE_CWD, MULMOTERMINAL_HOME).catch(() => {});
// The removed Docker sandbox left two things behind when a server was killed or upgraded
// mid-session: a per-session export of the Keychain credential on disk, and a container still
// running with the workspace and ~/.claude mounted. Both deleters went with the feature.
//
// The directory is the EVIDENCE that this machine ever ran the sandbox, so the container sweep is
// gated on it: nearly every install never turned it on (opt-in, macOS-only) and never invokes
// docker here at all (Codex, PR #1195).
if (removeLegacySandboxCredentials(MULMOTERMINAL_HOME)) void removeLegacySandboxContainers(MULMOTERMINAL_HOME).catch(() => {});

// Codex costs nothing to read, so it is current before the first browser arrives.
refreshCodexRateLimits();

const app = express();
hideErrorStacks(app);
// Generous body limit: PostToolUse hook payloads carry the tool's full output
// (a big Read/Bash result can blow past Express's 100kb default, which would 413
// the hook and leave its tool-call entry stuck on "running").
mountAppRoutes(app, {
  clientDir: __dirname,
  rateLimits: {
    store: rateLimitStore,
    refreshCodex: refreshCodexRateLimits,
    startProbe: startClaudeRateLimitProbe,
    claudeAvailable: claudeIsRunnable,
    now_ms: () => Date.now(),
  },
  isAllowedOrigin,
  publish: (channel, data) => pubsub?.publish(channel, data),
  sessionChannel,
  toolStores,
  toolSummaries,
  spawnClaudePty,
  spawnCodexPty,
  spawnAntigravityPty,
  translateViaHiddenChat,
  freshenRosterTitle,
  forgetTitle,
  noteTitleTurn,
  noteWorkPhase: (id, event, toolName) => workPhaseTracker.note(id, event, toolName),
  maybeGenerateTitle,
  // Defined further down; reached only from a request, which cannot arrive before listen().
  registerBackgroundSession: (id: string) => scheduledSessions.register(id),
  agentOfSession: (id: string) => agentOfSession(id),
  setWorking,
  setWaiting,
  publishActivity,
  ...(mobileWebPushActivityDeps.notifyMobileWebPushActivity ? { notifyMobileWebPushActivity: mobileWebPushActivityDeps.notifyMobileWebPushActivity } : {}),
});

const server = http.createServer(app);
pubsub = createPubSub(server, isAllowedOrigin, MULMOTERMINAL_BASE_PATH);

// Wire the shared file-change publisher (markdown + html live-refresh) against
// pubsub + the workspace. Must run before any write route fires (publishFileChange
// is a no-op until configured).
initFileChangePublisher({ workspace: CLAUDE_CWD, pubsub });

// Wire the notification engine against pubsub + the shared workspace files. Must run
// before any publish/clear and before the collection watchers start.
await initNotifier({ workspace: CLAUDE_CWD, pubsub });

// Which sessions were `/clear`ed before this process started: tmux keeps their claude running
// across a restart, so the mark that stops us reading their frozen transcript has to come back
// with it (#1085). Awaited here — the readers are synchronous, and the first hook can arrive as
// soon as we listen.
await hydrateClearedTranscripts();

// Give the markdown host app its workspace (for artifacts/documents storage).
// File-change live-refresh is handled by the shared publisher above.
initMarkdownBackend({ workspace: CLAUDE_CWD });

// Give the artifacts FileOps backend its workspace root (<workspace>/artifacts) so
// @mulmoclaude/chart-plugin's executeChart can persist chart documents there.
initArtifactsBackend({ workspace: CLAUDE_CWD });

// Give the by-path backend the same workspace — presentDocument / presentHtml's
// `path` argument resolves workspace-relative values against it (absolute ones are
// taken as-is), and the /htmlfile mount resolves its `ws` scope from it.
initOpenPathBackend({ workspace: CLAUDE_CWD });

// Create the mulmoScript server ops (stories dir under <workspace>/artifacts,
// generation fan-out on the plugin pubsub channel). After initArtifactsBackend —
// the ops' save/update kinds run against the artifacts FileOps.
initMulmoScriptBackend({ workspace: CLAUDE_CWD, pubsub });

// Give factory-style gui-chat-protocol plugins their scoped runtime (per-package
// data/config under <workspace>, namespaced pub/sub, prefixed log) — see
// infra/pluginRuntime.ts. This necessarily lands AFTER the plugin registry built
// those runtimes (it calls the factories from a top-level await, so it finishes
// while this module's imports evaluate); the runtime tolerates that by resolving
// the workspace per operation rather than capturing it at construction.
initPluginRuntime({ workspace: CLAUDE_CWD, publish: (channel, data) => pubsub?.publish(channel, data) });

// Bind @mulmoclaude/core/google's logger. Token/secret storage is core's own and is
// shared with MulmoClaude (~/.config/mulmo, ~/.secrets), so a machine links once.
initGoogleBackend();

// The mobile terminal view (#435). Both accessors live here because the PTY table
// and the title/activity side-tables do; the backend only sees the two functions.
// The Core metadata records the kind of Terminal that was launched. A shell remains a shell
// Terminal when its foreground command changes; pane command is runtime activity, not identity.
const agentOfSession = async (id: string): Promise<SessionAgent | null> => {
  return (await coreSessions.find(id))?.agent ?? null;
};

// What each session's directory is working on, resolved once per DIRECTORY before the list is
// built: `detailOf` below is synchronous, and cells sharing a checkout share an answer (#1014).
// phaseForRepoBranch caches per (repo, branch), so a grid of twenty cells costs a handful of gh
// calls at most, and none at all between polls inside the TTL.
const workByCwd = async (cwds: readonly string[]): Promise<Map<string, SessionWorkSummary>> => {
  const out = new Map<string, SessionWorkSummary>();
  await Promise.all(
    [...new Set(cwds.filter((cwd) => cwd !== ""))].map(async (cwd) => {
      try {
        const status = await gitStatus(cwd);
        if (!status.repo || !status.branch) return;
        const repo = (await repoForDir(cwd))?.repo ?? null;
        if (!repo) return;
        const summary = sessionWorkSummary(await phaseForRepoBranch(repo, status.branch));
        if (summary) out.set(cwd, summary);
      } catch {
        // best-effort: a directory that cannot be resolved simply carries no work item
      }
    }),
  );
  return out;
};

const mobileListTerminalSessions = async () => {
  // Core owns existence; this filter is display policy shared with the desktop grid. Internal
  // helpers remain directly addressable for their completion/push flows but are not terminal rows.
  const sessions = await visibleCoreSessions(await coreSessions.list());
  const runningIds = sessions.filter((session) => !session.exited).map((session) => session.id);
  const work = await workByCwd(sessions.map((session) => session.cwd));
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return buildSessionList({
    candidateIds: sessions.map((session) => session.id),
    liveIds: runningIds,
    tmuxIds: runningIds,
    detailOf: (id) => {
      const session = byId.get(id);
      if (!session) return { title: "", cwd: "", agent: null };
      const summary = work.get(session.cwd);
      const detail: SessionDetailDraft = {
        title: sessionDisplayName(session.memo, session.title, lastPrompts.get(id), null),
        cwd: session.cwd,
        agent: session.agent,
        ...(summary ? { work: summary } : {}),
      };
      return detail;
    },
  });
};

const mobileWriteToSession = async (sessionId: string, chunk: string): Promise<boolean> => {
  try {
    await coreSessions.input(sessionId, chunk);
    return true;
  } catch (error) {
    if (error instanceof CoreSessionNotFoundError) return false;
    throw error;
  }
};

const mobileSessionOperations = createCoreSessionOperations();

// Whether the phone's typing may empty the input box before pasting, so only the
// phone's text is submitted (#572). The rule itself lives with the sender.
const mobileCanClearBox = async (sessionId: string): Promise<boolean> =>
  canClearInputBox((await coreSessions.get(sessionId)).agent, activity.get(sessionId)?.working);

// What the phone's per-session view heads the screen with (#786, mulmoserver#107): the same
// dir / branch / memo / summary / prompt the grid cell shows, read from the tables /api/sessions
// answers from. A session that outlived a restart has no PtyEntry, so it falls back to the
// persisted cwd written when the session was launched or attached.
const mobileSessionScreenMeta = async (sessionId: string): Promise<SessionScreenMeta> => {
  const session = await coreSessions.get(sessionId);
  return buildScreenMeta(sessionId, {
    cwdOf: () => session.cwd,
    branchOf: async (cwd) => (await currentBranch(cwd)).branch,
    // The repository root, never /tree/<branch>: whether a branch is still ON GitHub cannot
    // be known without asking GitHub. `refs/remotes/origin/*` is a local cache, so a merged
    // branch deleted at merge time keeps resolving here until someone prunes — and every
    // branch this app creates is deleted that way. Measured: the tree URL 404s, the root
    // does not. A per-poll `ls-remote` is the only local fix and costs a network round trip
    // on a screen the phone polls (#832).
    githubUrlOf: resolveGithubUrl,
    memoOf: () => session.memo ?? "",
    summaryOf: () => session.title ?? "",
    promptOf: (id) => lastPrompts.get(id) ?? "",
    memosHydrated: Promise.resolve(),
  });
};

const mobileCaptureTerminalScreen = async (sessionId: string) => {
  try {
    const session = await coreSessions.get(sessionId);
    const [screen, meta] = await Promise.all([coreSessions.screen(sessionId), mobileSessionScreenMeta(sessionId)]);
    return coreTerminalScreen(screen, meta, quickCommandsForAgent(getQuickCommands(), session.agent));
  } catch (error) {
    if (error instanceof CoreSessionNotFoundError) throw new TerminalSessionNotFoundError(sessionId);
    throw error;
  }
};

// The LOCAL mobile route's colour layer (#7). Deliberately its own capture rather than a field
// added to SessionScreen: the plain screen response stays compact and older clients can ignore
// styled rows entirely.
//
// Same two capture paths as mobileCaptureTerminalScreen, in the same order (tmux first),
// so a session picks the same source for both its plain and its styled screen — just read for
// colour (ansiSegments.ts / headlessScreen.ts's renderAnsiRows) instead of for plain text.
// ansiScreenWindow applies the SAME row cap AND byte cap terminalScreen.ts's own screenWindow
// applies to the plain screen, so the two never disagree on how much of the pane is shown.
const localMobileCaptureStyledScreen = async (sessionId: string): Promise<AnsiRow[]> => {
  const captured = tmuxCaptureStyledPane(sessionId, SCREEN_HISTORY_ROWS);
  if (captured !== null) return ansiScreenWindow(parseAnsiRows(captured));
  const entry = ptys.get(sessionId);
  if (!entry) throw new TerminalSessionNotFoundError(sessionId);
  const rows = await renderAnsiRows({ buffer: entry.buffer, cols: entry.term.cols, rows: entry.term.rows, historyLines: SCREEN_HISTORY_ROWS });
  return ansiScreenWindow(rows);
};

const mobileTerminalLauncher = createLaunchTerminalPublisher({
  pubsub,
  cwdOfSession: async (id) => (await coreSessions.find(id))?.cwd ?? null,
});
const localMobileTerminalCreator = createLocalMobileTerminalCreator({ spawnClaudePty, spawnCodexPty, spawnAntigravityPty, spawnLauncherPty });

// The byte(s) that submit for a given session (#772), resolved live from config per agent.
const sessionSubmitSequence = async (sessionId: string) => submitSequenceForAgent((await coreSessions.get(sessionId)).agent, getTerminalSubmit());
// Which agent the typed text is going to, for the completion-menu guard (#1142) — only Claude
// Code has the menu that eats a submit, and only there is the guard's trailing space not real
// input. Same lookup as sessionSubmitSequence above; shared for the same reason.
const sessionAgentFor = async (sessionId: string) => (await coreSessions.get(sessionId)).agent;
const sharedMobileTerminalDeps = {
  listTerminalSessions: mobileListTerminalSessions,
  captureTerminalScreen: mobileCaptureTerminalScreen,
  acknowledgeTerminalView: acknowledgeShellDone,
  writeToSession: mobileWriteToSession,
  ...mobileSessionOperations,
  canClearBox: mobileCanClearBox,
  submitSequence: sessionSubmitSequence,
  sessionAgent: sessionAgentFor,
  launchTerminal: mobileTerminalLauncher.fromSession,
};

// What the LOCAL mobile route's `activity` field reads (server/routes/local-mobile-terminal-
// routes.ts) — the same `activity` map and work-phase tracker the desktop roster reads, joined by
// session id rather than added to buildSessionList/TerminalSessionSummary.
const localMobileActivityOf = (id: string) => normalizeActivity(activity.get(id));
const localMobileWorkPhaseOf = (id: string) => workPhaseTracker.phaseOf(id);

const coreLifecycle = (session: { exited: boolean; attached: boolean }) => {
  if (session.exited) return "stopped" as const;
  return session.attached ? ("live" as const) : ("detached" as const);
};

const orchestratorSessionStatusOf = async (id: string) => {
  try {
    const session = await coreSessions.get(id);
    const inputAvailable = !session.exited;
    return {
      ok: true as const,
      sessionId: session.id,
      agent: session.agent,
      cwd: session.cwd,
      lifecycle: coreLifecycle(session),
      runtime: { pty: ptys.has(id), tmux: true, attached: session.attached },
      activity: { ...normalizeActivity(activity.get(id)), at: activity.get(id)?.at ?? 0, workPhase: workPhaseTracker.phaseOf(id) },
      input: inputAvailable
        ? { available: true, ready: true, known: true, source: "quiet" as const, checkedAt: Date.now(), reason: "Core session is running" }
        : { available: false, ready: false, known: true, source: "unavailable" as const, checkedAt: Date.now(), reason: "Core session has exited" },
      inputAvailable,
      readyForInput: inputAvailable,
    };
  } catch (error) {
    if (error instanceof CoreSessionNotFoundError) return null;
    throw error;
  }
};

mountConfiguredMobileTransport({
  app,
  isAllowedOrigin,
  terminalDeps: sharedMobileTerminalDeps,
  localExtras: {
    captureStyledScreen: localMobileCaptureStyledScreen,
    createTerminalAtCwd: localMobileTerminalCreator,
    activityOf: localMobileActivityOf,
    workPhaseOf: localMobileWorkPhaseOf,
    setWaiting,
    mobileWebPush,
  },
});

mountOrchestratorSessionRoutes(app, {
  ...sharedMobileTerminalDeps,
  createTerminalAtCwd: localMobileTerminalCreator,
  setWaiting,
  statusOf: orchestratorSessionStatusOf,
  isAllowedOrigin,
});

// User-task scheduler: cron tasks from config/scheduler/tasks.json fire on schedule
// and spawn a NEW chat seeded with the task's prompt (e.g. the workout-log weekly
// nudge). The run-binding spawns a VISIBLE session so the user sees the result.
// Non-fatal: a scheduler failure must never abort startup.
//
// Nobody ever presses close on a scheduled session, and one blocked on a permission prompt
// never finishes a turn, so the hook-driven reap can miss it entirely — hence the
// registry, which bounds them by count and age whatever their hooks did (#541).

// The rule lives with heldByAnotherProcess (pure/tested); this only reads the live facts.
const sessionInUse = (id: string): boolean => {
  const entry = ptys.get(id);
  return scheduledSessionInUse({ hasViewer: !!entry?.ws, weHoldAPty: !!entry }, () => tmuxAttachedClientCount(id));
};

const scheduledSessions = createScheduledSessionRegistry({
  dir: scheduledSessionsDir(CLAUDE_CWD, MULMOTERMINAL_HOME),
  isValidId: (id) => SESSION_ID_RE.test(id),
  isInUse: sessionInUse,
  reapSession: reap,
  deleteSession: async (id) => {
    try {
      await coreSessions.delete(id);
    } catch (error) {
      if (!(error instanceof CoreSessionNotFoundError)) throw error;
    }
  },
});
// Sweep at startup (catching sessions that outlived a restart — tmux survives one by
// design) and hourly, so the age cap holds even after the schedule is turned off.
const SCHEDULED_SWEEP_INTERVAL_MS = 60 * 60_000;
void scheduledSessions.sweep();
setInterval(() => void scheduledSessions.sweep(), SCHEDULED_SWEEP_INTERVAL_MS).unref();

// A user's scheduled task runs as a BACKGROUND WORKER — see scheduled-chat.ts for why, and for
// what follows from it (no grid cell, but a failed one still says so).
function spawnScheduledChat(message: string): void {
  const sessionId = randomUUID();
  try {
    spawnScheduledWorker(sessionId, {
      spawn: (id, visibility) => spawnClaudePty(id, null, null, { initialPrompt: message, visibility }),
      retain: (id) => scheduledSessions.register(id),
    });
  } catch (err) {
    console.error(`[scheduler] failed to spawn chat for a scheduled task: ${messageOf(err)}`);
  }
}
try {
  initUserTaskScheduler({
    workspace: CLAUDE_CWD,
    spawnChat: spawnScheduledChat,
    systemTasks: [],
  });
} catch (err) {
  console.error("[scheduler] init failed (non-fatal)", err);
}

// The terminal WebSocket endpoints (routes/ws-routes.ts).
const terminalWebSockets = mountTerminalWebSockets({
  server,
  isAllowedOrigin,
  claudeBin: CLAUDE_BIN,
  setWaiting: (id, waiting) => setWaiting(id, waiting),
  reattachPty,
  handleClientFrame,
  handleClientClose,
  spawnClaudePty,
  spawnCodexPty,
  spawnAntigravityPty,
  spawnCommandPty,
  spawnLauncherPty,
  resolveLauncher,
});

// A bind failure (most often the port already in use) must not surface as an unhandled
// 'error' event / stack trace — exit with a clear message and the code the launcher reads
// (infra/server-exit.ts).
server.on("error", (err) => {
  const { message, code } = serverErrorExit(err, PORT);
  console.error(message);
  process.exit(code);
});

// Number(): PORT comes from the environment as a string, and the (port, host, cb) overload
// takes a number — the (port, cb) form we used before accepted either.
// Express types the listen callback as void, but startup discovery is necessarily asynchronous.
// eslint-disable-next-line @typescript-eslint/no-misused-promises
server.listen(Number(PORT), BIND_HOST, async () => {
  console.log(`mulmoterminal running at http://localhost:${PORT}`);
  if (!isLoopbackBinding(server.address())) {
    console.warn(bindSecurityWarning(BIND_HOST, PORT, browserHostnames));
  }
  const surviving = (await coreSessions.list()).map((session) => session.id);
  const detail = surviving.length ? ` — ${surviving.length} session(s) survived; reattach on connect` : "";
  console.log(`[tmux] Core session runtime on${detail}`);
  // Say we are here, so a later launcher can warn about a second instance and a later boot can
  // tell our live files from a dead server's leftovers (#1061).
  const unregisterInstance = registerInstance(Number(PORT));
  process.on("exit", unregisterInstance);

  // A crash never reaches reap(), so settings files — one of which may hold a provider's API
  // token — outlive the sessions that used them. Anything not backed by a surviving tmux
  // session is an orphan: a PTY without tmux died with the server that owned it.
  //
  // …but only for OUR previous lifetime. A peer running right now has live PTYs, and without
  // tmux `surviving` is empty, so its files looked like leftovers and were deleted underneath it
  // (#1061). Files older than the earliest live peer cannot be theirs; newer ones might be — and
  // that cutoff applies to every sweep here, not just the one the bug was reported against.
  const peers = liveInstances();
  const peerCutoff = earliestStartedAt(peers);
  const liveSessionIds = new Set(surviving);
  const droppedSettings = pruneOrphanSettings(liveSessionIds, undefined, peerCutoff);
  if (droppedSettings.length) console.log(`[settings] removed ${droppedSettings.length} orphaned session settings file(s)`);
  // Dropped files are the same story: copies in tmp that only their session referred to.
  const droppedDrops = pruneOrphanDrops(liveSessionIds, undefined, peerCutoff);
  if (droppedDrops.length) console.log(`[drops] removed ${droppedDrops.length} orphaned session drop director(ies)`);
  if (peers.length) {
    const where = peers.map((p) => (p.port === null ? `pid ${p.pid}` : `port ${p.port}`)).join(", ");
    console.warn(`[instances] ${peers.length} other MulmoTerminal server(s) running (${where}) — they share ~/.mulmoterminal, which is not a supported setup`);
  }

  // Run the update check for the header badge (best-effort, non-blocking). Works under
  // `yarn dev` too, where the launcher — which used to be the only checker — isn't involved.
  void refreshUpdateStatus();
});

installGracefulShutdown({
  server,
  stopSidecars: stopWhisperSidecar,
  cleanupManagedLiveSessions: lifecycle.cleanupManagedLiveSessions,
  closeRealtime: () => void (terminalWebSockets.close(), pubsub?.close()),
  exit: (code) => process.exit(code),
});
