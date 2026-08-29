// The terminal WebSocket endpoints: /ws (claude), /ws/run (a one-off command), /ws/launch
// (a configured launcher) and /ws/codex. Split from index.ts (#548 step 3e) — the last of
// the terminal machinery, and the composition root that ties the spawners, the connection
// plumbing and the session decisions together.
//
// What index.ts still owns arrives as deps: the http server whose upgrade event these hang
// off, the origin check, the working/waiting flags, and the spawners it built.
import type { IPty } from "node-pty";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { messageOf } from "../errors.js";
import { CLAUDE_CWD, PORT, SESSION_ID_RE, MULMOTERMINAL_BASE_PATH } from "../config/env.js";
import { workspaceRequest } from "../config/workspace.js";
import { getHeaderConfig } from "../config/config-routes.js";
import { buildHeaderContext, loadHeaderConfig } from "../config/header-context.js";
import { resolveButtonCommand, shellQuoteFor } from "../config/header-resolve.js";
import { resolveScript } from "../files/scripts.js";
import { launchChoiceFromParams } from "../session/launch-choice.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { antigravityBrainRoot, antigravityConversationExists } from "../agents/antigravity-session.js";
import { codexRolloutExists } from "../agents/codex-sessions.js";
import { viewerPtys } from "../session/viewer-state.js";
import { SpawnRefusedError } from "../session/pty-spawn.js";
import { bufferEarlyFrames, type EarlyFrames } from "../session/early-frames.js";
import { launcherCommandWithGuiMcp, launcherRunsAgent } from "../session/launcher-gui-mcp.js";
import { codexGuiMcpServers } from "../session/mcp-config.js";
import { registeredGuiMcpGroups } from "../infra/gui-mcp-registration.js";
import { TOOL_GROUPS, type ToolGroup } from "../../common/toolGroups.js";
import { parseTerminalSize, type TerminalSize } from "../../common/terminalSize.js";
import { handleCommandFrame } from "../session/pty-connection.js";
import { closeWithError, sendFrame } from "../session/ws-frames.js";
import { ProviderRefusedError } from "../session/provider-env.js";
import { sessionExistsOnDisk } from "../session/session-reads.js";
import { canStartLauncher, isContinuingSession, resolveReattachableId, resolveSession, type SessionResolution } from "../session/session-resolve.js";
import type { PtyEntry } from "../session/types.js";
import type { SpawnClaudePty, SpawnCodexPty, SpawnAntigravityPty, SpawnCommandPty, SpawnLauncherPty, ResolveLauncher } from "../session/spawners.js";
import { terminalWsKind, type TerminalWsKind } from "./terminal-ws-path.js";
import { normalizeAgent, parseIndexParam } from "./routeParams.js";
import { agentResumeId } from "../agents/agent-resume.js";
import { claimLaunch, worktreeOccupancy } from "../session/worktree-session-limit.js";
import { worktreeRefusal } from "../../common/worktreeSession.js";
import { stripBasePath } from "../../common/basePath.js";
import type { SessionAgent } from "../../common/sessionAgent.js";
import { coreSessions, type CoreSession } from "../session/core-session-adapter.js";
import { beginPendingTerminalLaunch, finishPendingTerminalLaunch } from "../session/pending-terminal-launch.js";

export interface WsRouteDeps {
  /** The http server these endpoints hang their `upgrade` handler off. */
  server: Server;
  /** Only same-machine browser origins may open a terminal socket. */
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  claudeBin: string;
  setWaiting: (id: string, waiting: boolean) => void;
  reattachPty: (entry: PtyEntry, ws: WebSocket, sessionId: string) => PtyEntry;
  handleClientFrame: (entry: PtyEntry, ws: WebSocket, raw: { toString(): string }, sessionId: string) => void;
  handleClientClose: (entry: PtyEntry, ws: WebSocket, sessionId: string) => void;
  spawnClaudePty: SpawnClaudePty;
  spawnCodexPty: SpawnCodexPty;
  spawnAntigravityPty: SpawnAntigravityPty;
  spawnCommandPty: SpawnCommandPty;
  spawnLauncherPty: SpawnLauncherPty;
  spawnViewerPty: (sessionId: string, ws: WebSocket, cwd: string, agent: SessionAgent) => PtyEntry;
  resolveLauncher: ResolveLauncher;
  /** Build one current display snapshot from Core/activity/transcript state on connect. */
  sessionStateOf?: (sessionId: string, cwd: string) => Promise<unknown>;
}

export function attachViewer(deps: Pick<WsRouteDeps, "spawnViewerPty" | "reattachPty">, viewer: PtyEntry, ws: WebSocket, sessionId: string): PtyEntry {
  if (viewer.ws && viewer.ws.readyState === viewer.ws.OPEN) return deps.spawnViewerPty(sessionId, ws, viewer.cwd, viewer.agent);
  return deps.reattachPty(viewer, ws, sessionId);
}

export function sessionAgentForWsKind(kind: TerminalWsKind): SessionAgent | null {
  if (kind === "claude" || kind === "codex" || kind === "antigravity") return kind;
  return null;
}

// A requested Core member keeps its terminal id. Agent history can supply a resume id only when
// Core has no such member, and then the terminal receives a newly minted id.
// The command a launcher runs when spawned fresh. On a Core reattach it is ignored.
const DEFAULT_LAUNCH_CMD = process.env.SHELL || "/bin/sh";

async function requestedCoreSession(requested: string | null): Promise<CoreSession | null> {
  return requested ? coreSessions.findByReference(requested) : null;
}

async function resolveClaudeSession(requested: string | null, cwd: string): Promise<SessionResolution & { core: CoreSession | null }> {
  const core = await requestedCoreSession(requested);
  const hasViewer = !!core && viewerPtys.has(core.id);
  const onDisk = !core && !!requested && sessionExistsOnDisk(requested, cwd);
  return { ...resolveSession(core?.id ?? requested, { coreExists: !!core, hasViewer, onDisk }, randomUUID), core };
}

// The params every terminal WebSocket reads: the request URL, the validated
// session id, and the resolved cwd. A non-UUID session id is treated as "no
// session" — it could otherwise smuggle path/flag fragments into
// sessionExistsOnDisk / --resume — and cwd (?cwd=<abs>) falls back to CLAUDE_CWD.
/**
 * Where a session actually runs, for the value that gets REMEMBERED (#1021).
 *
 * A reattach often carries no `?cwd=` — and `resolveWorkspace` answers the default workspace when
 * it is missing, so trusting the request would record CLAUDE_CWD for a session running somewhere
 * else entirely, and the phone would later show that directory's PR. Core metadata knows where an
 * existing terminal runs; the request only decides where a NEW one will spawn.
 * Same rule the `session` message already follows when it reports the cwd back to the browser.
 */
export function effectiveSessionCwd(coreCwd: string | undefined, requestCwd: string): string {
  return coreCwd ?? requestCwd;
}

// The slice of Node's IncomingMessage the upgrade handlers read. Structural rather than the
// real type so a test can hand over a literal; `| undefined` because IncomingMessage.url is
// genuinely absent on some upgrades.
type WsUpgradeRequest = { url?: string | undefined; headers?: unknown };

// The default is still what an unusable `?cwd=` resolves to, because a REATTACH is allowed to
// proceed on it (see refuseUnusableWorkspace) and handing tmux a directory that is not there
// would break the one path this must not break.
export function workspaceFromUrl(url: URL): { cwd: string; unusable: string | null } {
  // getAll, not get: a repeated `?cwd=a&cwd=b` names two directories, and `get` would silently
  // pick the first — the same swap this exists to stop, and the HTTP routes already refuse it
  // (express hands them the array). Passing the array on keeps ONE rule for both transports.
  const values = url.searchParams.getAll("cwd");
  const request = workspaceRequest(values.length > 1 ? values : values[0]);
  if (request.kind === "unusable") return { cwd: CLAUDE_CWD, unusable: request.problem };
  return { cwd: request.cwd, unusable: null };
}

function wsConnectionContext(req: WsUpgradeRequest): {
  url: URL;
  requested: string | null;
  cwd: string;
  unusable: string | null;
  size: TerminalSize | null;
} {
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.searchParams.get("session");
  const requested = raw && SESSION_ID_RE.test(raw) ? raw : null;
  return { url, requested, size: sizeFromUrl(url), ...workspaceFromUrl(url) };
}

// This is admission serialization only, not membership state: a key exists solely while a
// connection is between its Core lookup and synchronous Core creation. Once creation returns,
// Core metadata is again the complete authority for resolving the history reference.
const historyAdmissionClaims = new Map<string, Promise<void>>();

export async function withHistoryAdmissionClaim<T>(reference: string | null, run: () => Promise<T>): Promise<T> {
  if (!reference) return run();
  const previous = historyAdmissionClaims.get(reference) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.catch(() => undefined).then(() => held);
  historyAdmissionClaims.set(reference, tail);
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (historyAdmissionClaims.get(reference) === tail) historyAdmissionClaims.delete(reference);
  }
}

function requestedReference(req: WsUpgradeRequest): string | null {
  const raw = new URL(req.url ?? "/", "http://localhost").searchParams.get("session");
  return raw && SESSION_ID_RE.test(raw) ? raw : null;
}

/** The geometry the browser has already fitted its terminal to, or null when it sent none it can
 *  stand behind — the same bounds a `resize` frame is held to. */
function sizeFromUrl(url: URL): TerminalSize | null {
  return parseTerminalSize(url.searchParams.get("cols"), url.searchParams.get("rows"));
}

// Put the browser's geometry on the pty the moment it exists. A pty is created at the server's
// default and learns the real size from the first `resize` frame — a SEPARATE message, which has to
// survive the spawn to be heard at all (#1178). Applying the URL's size here means the program
// inside never draws a frame at a size nobody asked for, and a lost first frame costs nothing.
// A reattach gets it too: the browser's current size is what that session should be at.
function applyClientSize(term: IPty, size: TerminalSize | null, tag: string, sessionId: string): void {
  if (!size) return;
  try {
    term.resize(size.cols, size.rows);
  } catch (err) {
    // e.g. the pty exited between the spawn and here — the resize frame will retry it.
    console.warn(`[ws/${tag}] ${sessionId}: initial resize dropped: ${messageOf(err)}`);
  }
}

// A directory was named and cannot be entered. For a FRESH start that is the end of it: this is
// the refusal `ptySpawn` would have made (#1078), moved to the only place it can still happen —
// `resolveWorkspace` used to swap the path for the default workspace first, so the terminal came
// up silently in another project and #1146 had no symptom but "it opened somewhere else" (#1151).
//
// A reattach is let through with a warning, exactly as `refuseUnusableCwd` lets one through:
// shutting someone out of an agent that is still running because they moved its directory would
// be a worse bug than the one being reported. It runs no new program, and the cwd it reports
// comes from the live PTY rather than from this request (effectiveSessionCwd).
export async function refuseUnusableWorkspace(ws: WebSocket, kind: TerminalWsKind, unusable: string | null, requested: string | null): Promise<boolean> {
  if (!unusable) return false;
  if (await requestedCoreSession(requested)) {
    console.warn(`[ws/${kind}] attaching ${requested} despite an unusable ?cwd= — ${unusable}`);
    return false;
  }
  console.warn(`[ws/${kind}] refusing to start — ${unusable}`);
  closeWithError(ws, unusable);
  return true;
}

/**
 * Refuse a FRESH agent session in a worktree that already has one (#1207).
 *
 * Only a fresh one: reattaching or resuming a session that already exists is the whole point of
 * the rule, not a violation of it. The refusal has to happen before the browser is told a session
 * id, or a cell adopts an id for a terminal that is about to be closed under it.
 *
 * "Fresh" is read off the id the resolver settled on rather than re-listing the ways a session can
 * continue: every resolver here keeps the REQUESTED id exactly when something can serve it (a live
 * pty, a surviving tmux session, a transcript or rollout to resume) and mints a new one otherwise.
 * Codex caught the first version spelling that list out per call site and omitting tmux-only
 * liveness — which reads a reconnect after a server restart as a brand-new session (#1208).
 */
async function refuseSecondWorktreeSession(
  ws: WebSocket,
  kind: TerminalWsKind,
  cwd: string,
  session: { requested: string | null; sessionId: string },
): Promise<boolean> {
  if (isContinuingSession(session.requested, session.sessionId)) return false;
  // Claimed BEFORE the occupancy read, which is asynchronous: two launches aimed at one worktree
  // would otherwise both read it as free and both spawn (#1208, found by Codex). The claim is
  // dropped with the socket, which covers every early return below as well as a client that leaves
  // mid-check; a claim held past the spawn costs nothing, since the pty then occupies the worktree
  // on its own account.
  const claim = claimLaunch(cwd);
  ws.once("close", claim.release);
  const { isWorktree, session: occupied } = await worktreeOccupancy(cwd);
  if (!isWorktree) return false;
  const reason = worktreeRefusal(occupied, claim.contended);
  if (!reason) return false;
  console.warn(`[ws/${kind}] refusing a second session in ${cwd} — ${reason}`);
  closeWithError(ws, reason);
  return true;
}

/**
 * Everything an agent endpoint does between resolving its session and spawning it, in the order
 * the four of them (claude, launch, codex, antigravity) already ran it in.
 *
 * The order is the fragile part: the worktree refusal has to happen BEFORE the browser is told a
 * session id (#1207). Terminal membership itself is read only from Core.list().
 *
 * Returns null when the socket was refused and closed: the caller must return without spawning.
 */
async function admitAgentSession(
  ws: WebSocket,
  kind: TerminalWsKind,
  session: {
    requested: string | null;
    sessionId: string;
    viewer: PtyEntry | undefined;
    cwd: string;
    /** False only for a launcher that runs no agent — `yarn dev` is not an agent editing the tree
     *  and stays free of the one-session-per-worktree rule (see launcherRunsAgent). */
    worktreeLimited?: boolean;
  },
): Promise<EarlyFrames | null> {
  const { requested, sessionId, viewer, cwd, worktreeLimited = true } = session;
  if (worktreeLimited && (await refuseSecondWorktreeSession(ws, kind, cwd, { requested, sessionId }))) return null;
  beginPendingTerminalLaunch(sessionId);
  // The EFFECTIVE cwd, not this request's: on a reattach the live PTY's own directory is where the
  // agent really runs, and the request's `?cwd=` is ignored by everything downstream.
  return announceSession(ws, sessionId, viewer?.cwd ?? cwd);
}

async function resolveButtonRun(url: URL, cwd: string): Promise<{ command: string; cwd: string } | null> {
  const buttonId = url.searchParams.get("buttonId");
  if (!buttonId) return null;
  const sessionRaw = url.searchParams.get("session");
  const session = sessionRaw && SESSION_ID_RE.test(sessionRaw) ? sessionRaw : null;
  const agent = normalizeAgent(url.searchParams.get("agent"));
  const config = loadHeaderConfig(cwd, getHeaderConfig());
  const context = await buildHeaderContext(cwd, { session, agent, model: url.searchParams.get("model") });
  const command = resolveButtonCommand(config, context, buttonId, shellQuoteFor(process.platform));
  return command ? { command, cwd } : null;
}

async function resolveRunTarget(url: URL, cwd: string): Promise<{ command: string; cwd: string } | null> {
  const byButton = await resolveButtonRun(url, cwd);
  if (byButton) return byButton;
  return resolveScript(cwd, parseIndexParam(url.searchParams.get("index")));
}

// A terminal socket is a raw EventEmitter: an unhandled 'error' (a client whose network
// drops mid-session emits ECONNRESET/EPIPE) is re-thrown by the ws library and would crash
// the whole backend — disconnecting EVERY terminal, not just this one, and leaving the Vite
// dev proxy to flood the console with ECONNREFUSED. Attach a no-op-but-logging listener
// before the connection handler runs so one dropped client stays one dropped client. Wired
// at the single handleUpgrade choke point, so it covers claude/run/launch/codex alike.
export function attachSocketErrorLogger(ws: Pick<WebSocket, "on">, kind: TerminalWsKind): void {
  ws.on("error", (err) => console.warn(`[ws] socket error (${kind}): ${messageOf(err)}`));
}

async function startRunTerminal(deps: WsRouteDeps, ws: WebSocket, url: URL): Promise<void> {
  // No session to reattach: /ws/run is ephemeral, so an unusable directory is always a refusal.
  const { cwd, unusable } = workspaceFromUrl(url);
  if (await refuseUnusableWorkspace(ws, "run", unusable, null)) return;
  const resolved = await resolveRunTarget(url, cwd);
  if (!resolved) return closeWithError(ws, "Command not found — check your config / script.json.");
  beginRunTerminal(deps, ws, resolved, sizeFromUrl(url));
}

// Spawn the ephemeral Run PTY and wire its lifecycle. resolveRunTarget above can await a git
// subprocess (buildHeaderContext for a button command), and the viewer can leave during that
// window — before any close handler is wired. Spawning then leaks a PTY nobody reaps (/ws/run
// is ephemeral: no reattach, so its only kill is the close handler below). Bail
// if the socket has since closed — the same guard handleClaudeConnection applies after its
// keychain refresh.
export function beginRunTerminal(deps: WsRouteDeps, ws: WebSocket, resolved: { command: string; cwd: string }, size: TerminalSize | null = null): void {
  if (ws.readyState !== ws.OPEN) return;
  let term: IPty;
  try {
    term = deps.spawnCommandPty(resolved.command, resolved.cwd, ws);
  } catch (err) {
    console.error(`[ws/run] failed to start command: ${messageOf(err)}`);
    return closeWithError(ws, `Failed to start the command: ${messageOf(err)}`);
  }
  applyClientSize(term, size, "run", "command");
  ws.on("message", (raw) => handleCommandFrame(term, raw));
  ws.on("close", () => {
    try {
      term.kill(); // ephemeral: no reattach/grace window — the viewer is gone, so end the process
    } catch {
      // already exited — nothing to kill
    }
  });
}

// Reattach a same-process viewer PTY, else spawn a launcher (which itself reattaches a
// surviving tmux session or creates one). `command` is the resolved launcher command,
// or the fallback for a tmux reattach with no launcher index.
interface LaunchStart {
  sessionId: string;
  viewer: PtyEntry | undefined;
  command: string;
  cwd: string;
  coreSessionExists: boolean;
}

function startLaunchEntry(deps: WsRouteDeps, ws: WebSocket, start: LaunchStart): PtyEntry {
  const { sessionId, command, cwd, coreSessionExists } = start;
  const viewer = viewerPtys.get(sessionId);
  if (viewer) return attachViewer(deps, viewer, ws, sessionId);
  return deps.spawnLauncherPty(sessionId, ws, command, cwd, coreSessionExists);
}

// Resolve a launcher ws request to a session: reattach a viewer PTY / surviving tmux
// session (id kept, running program picked up via `tmux new-session -A`, command ignored),
// or a fresh spawn of the indexed launcher command. Returns null when there's nothing to
// reattach AND the index isn't a configured launcher.
async function resolveLaunchSession(
  deps: WsRouteDeps,
  requested: string | null,
  index: number,
  shell: boolean,
): Promise<{ sessionId: string; viewer: PtyEntry | undefined; command: string; core: CoreSession | null } | null> {
  const core = await requestedCoreSession(requested);
  const viewer = core ? viewerPtys.get(core.id) : undefined;
  // A viewer PTY / surviving tmux session reattaches regardless of the index; only a fresh
  // spawn needs the launcher resolved (the pty already IS the chosen program on reattach).
  const launcher = core ? null : deps.resolveLauncher(index);
  if (!canStartLauncher({ coreExists: !!core, hasLauncher: !!launcher, isShell: shell })) return null;
  const { sessionId } = resolveReattachableId(core?.id ?? requested, { coreExists: !!core, hasViewer: !!viewer }, randomUUID);
  return { sessionId, viewer, command: launcher?.command ?? DEFAULT_LAUNCH_CMD, core };
}

// codex is a first-class agent like claude, but it mints its own session id (no --session-id),
// so the browser-facing id is a mulmoterminal-minted key; we discover codex's real rollout id
// after spawn and resume it with `codex resume <id>` once the viewer PTY is gone. Reattach a
// viewer PTY / surviving tmux session (running codex picked up, no resume); else cold-resume a known
// rollout id; else a fresh session (a new minted key).
async function resolveCodexSession(requested: string | null): Promise<{
  sessionId: string;
  viewer: PtyEntry | undefined;
  resumeRolloutId: string | null;
  core: CoreSession | null;
}> {
  const core = await requestedCoreSession(requested);
  const viewer = core ? viewerPtys.get(core.id) : undefined;
  const resumeRolloutId = agentResumeId(requested, {
    mappedId: core?.resumeSource ?? null,
    conversationExists: () => !!requested && codexRolloutExists(codexSessionsRoot(), requested),
    coreExists: !!core,
  });
  const { sessionId } = resolveReattachableId(core?.id ?? requested, { coreExists: !!core, hasViewer: !!viewer }, randomUUID);
  return { sessionId, viewer, resumeRolloutId, core };
}

// Grouped rather than eight positional arguments: what this needs is a session to (re)attach,
// a directory, and the GUI-tool decision — the last of which is now two values that only make
// sense together (attach everything, or exactly these groups).
interface CodexStart {
  sessionId: string;
  viewer: PtyEntry | undefined;
  resumeRolloutId: string | null;
  cwd: string;
  attachGuiMcp: boolean;
  mcpGroups: readonly ToolGroup[];
  coreSessionExists: boolean;
}

function startCodexEntry(deps: WsRouteDeps, ws: WebSocket, start: CodexStart): PtyEntry {
  const { sessionId, resumeRolloutId, cwd, attachGuiMcp, mcpGroups, coreSessionExists } = start;
  const viewer = viewerPtys.get(sessionId);
  if (viewer) return attachViewer(deps, viewer, ws, sessionId);
  return deps.spawnCodexPty(sessionId, ws, resumeRolloutId, cwd, attachGuiMcp, { mcpGroups, coreSessionExists }); // interactive: no seed
}

async function handleClaudeConnection(deps: WsRouteDeps, ws: WebSocket, req: WsUpgradeRequest) {
  // ?session=<id> resumes an existing conversation; absent => fresh session. For
  // new sessions we generate the id ourselves (--session-id) so the server always
  // knows the current session's id, even before any file exists.
  const { url, requested, cwd, unusable, size } = wsConnectionContext(req);
  if (await refuseUnusableWorkspace(ws, "claude", unusable, requested)) return;
  // A bad id is never silently reused — closing the socket without a replacement
  // makes the client auto-reconnect with the same bad id forever, so we warn and
  // fall through to mint a fresh session, then tell the browser the new id.
  const rawSession = url.searchParams.get("session");
  if (rawSession && !requested) console.warn(`[ws] ignoring non-UUID session id: ${JSON.stringify(rawSession)} — starting fresh`);

  // ?gui=0 (the grid's dev terminals) spawns claude WITHOUT the GUI plugin MCP /
  // --strict-mcp-config, so the user's + project's MCP servers load normally. Absent
  // (the single view) keeps main's behavior: GUI MCP attached + strict.
  const attachGuiMcp = url.searchParams.get("gui") !== "0";

  // ?provider=/?model= — what the launch form picked for THIS session (#584). It replaces
  // the directory's default; absent (the usual case) leaves that default alone. Ignored on
  // a reattach, where no spawn happens and the running session keeps what it started with.
  const launch = launchChoiceFromParams(url.searchParams);

  // Decide the effective session id BEFORE telling the browser. A requested id
  // is honored only if it can actually be served: a live pty (reattach) or an
  // on-disk transcript (`--resume`). A requested id that's neither — e.g. a cell
  // reloading an idle session claude never persisted — can't be reused: claude
  // exits with "session id already in use" if we retry `--session-id <same>`.
  // So mint a fresh id; the browser adopts it from this `session` message and
  // re-persists, so the reload just reopens a working terminal seamlessly.
  const { reattachId, resume, sessionId, core } = await resolveClaudeSession(requested, cwd);
  const viewer = reattachId ? viewerPtys.get(reattachId) : undefined;
  const effectiveCwd = core?.cwd || cwd;
  // Buffered from the announcement on, like every other terminal endpoint: the browser's first
  // frame is the terminal's geometry and it arrives while this handler may still be awaiting the
  // Keychain — /ws was the one route that let it fall on the floor (#1178, see early-frames.ts).
  const early = await admitAgentSession(ws, "claude", {
    requested: core?.id ?? requested,
    sessionId,
    viewer,
    cwd: effectiveCwd,
  });
  if (!early) return;

  // A provider refusal already says exactly what is wrong with the directory's config (#579), and a
  // refused spawn already names the binary and the PATH it searched, or the directory that is gone
  // (#1063, #1078); a generic hint would bury either.
  const startFailureMessage = (err: unknown): string =>
    err instanceof ProviderRefusedError || err instanceof SpawnRefusedError ? err.message : `Failed to start Claude: ${messageOf(err)}`;

  startAndWire(deps, ws, { id: sessionId, tag: "claude", early, startFailureMessage, stopLifecycleOnStartFailure: !core, size }, () => {
    // Admission above awaits worktree/provider checks. Re-read after that boundary: the captured
    // viewer may have been released by its old socket while this reconnect was waiting.
    const current = viewerPtys.get(sessionId);
    const entry = current
      ? attachViewer(deps, current, ws, sessionId)
      : deps.spawnClaudePty(sessionId, resume, ws, { cwd: effectiveCwd, attachGuiMcp, launch, coreSessionExists: !!core });
    // Single view (gui) = the attached session IS the actively-viewed pane, so mark it
    // read. A grid dev-terminal cell (gui=0) is only "viewed" once focused/zoomed (the
    // client then sends a `view` frame), so it stays inactive here and can surface
    // blocked/done while the user is on another cell or page.
    entry.active = attachGuiMcp;
    if (entry.active) deps.setWaiting(sessionId, false);
    return entry;
  });
}

// Command terminal: resolve the command SERVER-SIDE (the browser never sends a raw command) and run it
// in an ephemeral PTY. `?index=<n>&cwd=<dir>` runs <dir>/script.json[n]; `?buttonId=<id>&cwd&session&
// agent&model` runs a header run:"shell" button, re-resolved from config against the session context with
// shell-escaped ${vars}. When the socket closes, the process is killed.
function handleRunConnection(deps: WsRouteDeps, ws: WebSocket, req: WsUpgradeRequest) {
  void startRunTerminal(deps, ws, new URL(req.url ?? "/", "http://localhost"));
}

// A refused spawn already carries its own diagnosis — the missing CLI with the PATH that was
// searched (#1063), or the directory that is gone (#1078). Passing that through rather than
// wrapping it is what puts the real reason in the terminal instead of `spawn ENOENT`; everything
// else is an error nobody wrote for a reader, so it gets named.
export const startFailureMessageFor =
  (what: string) =>
  (err: unknown): string =>
    err instanceof SpawnRefusedError ? err.message : `Failed to start ${what}: ${messageOf(err)}`;

// Start the pty for a resolved session, then hand the socket to it — or fail the socket cleanly.
//
// One function for both agents because the ORDER is the fragile part, not the lines: the buffered
// early frames may only be replayed once the real message listener is installed, or a frame that
// lands mid-replay overtakes the ones before it (see early-frames.ts). Inlined, that rule was
// written as a comment on the codex path and nowhere on the launch path.
//
// `start` throwing is the spawn refusing — a missing CLI, a directory that vanished. The buffer is
// dropped rather than replayed: there is no pty to replay it into, and the socket is closing.
// `startFailureMessage` takes the error rather than being a fixed string, because what the user
// needs to read differs by cause: a pre-spawn diagnosis is already a sentence (#1063), anything
// else needs naming.
export function startAndWire(
  deps: Pick<WsRouteDeps, "handleClientFrame" | "handleClientClose" | "sessionStateOf">,
  ws: WebSocket,
  session: {
    id: string;
    tag: string;
    early: EarlyFrames;
    startFailureMessage: (err: unknown) => string;
    stopLifecycleOnStartFailure?: boolean;
    /** The browser's own geometry, off the connect URL. */
    size?: TerminalSize | null;
  },
  start: () => PtyEntry,
): void {
  try {
    let entry: PtyEntry;
    try {
      entry = start();
    } catch (err) {
      console.error(`[ws/${session.tag}] failed to start ${session.id}: ${messageOf(err)}`);
      session.early.discard();
      return closeWithError(ws, session.startFailureMessage(err));
    }
    // The primary browser owns the one Core/tmux pane geometry. A secondary keeps its own cursor,
    // but starts at the primary PTY size and must not replace that shared size from its URL.
    const primary = viewerPtys.get(session.id);
    if (!primary || primary === entry) applyClientSize(entry.term, session.size ?? null, session.tag, session.id);
    const deliver = (raw: { toString(): string }) => deps.handleClientFrame(entry, ws, raw, session.id);
    ws.on("message", deliver);
    ws.on("close", () => deps.handleClientClose(entry, ws, session.id));
    session.early.release(deliver);
    // This is the only unconditional state transfer: every connection/reconnection gets one
    // current snapshot. Later changes arrive on the existing event-driven `sessions` pub/sub
    // channel; an idle session schedules no reads and sends no repeated frame.
    if (deps.sessionStateOf) {
      void deps
        .sessionStateOf(session.id, entry.cwd)
        .then((state) => sendFrame(ws, { type: "session-state", requestId: 0, state }))
        .catch(() => {});
    }
  } finally {
    finishPendingTerminalLaunch(session.id);
  }
}

// Tell the browser which session this is, and from that moment collect what it sends: its first
// frame is the terminal's real geometry, and it arrives while the caller is still reading config
// files, so without this it lands on the floor (see early-frames.ts).
function announceSession(ws: WebSocket, sessionId: string, cwd: string): EarlyFrames {
  ws.send(JSON.stringify({ type: "session", id: sessionId, cwd }));
  return bufferEarlyFrames(ws);
}

// False when the client left during those reads — the caller must return WITHOUT spawning. A spawn
// for a socket that has already closed leaks a pty nobody reaps, because the close handlers are not
// installed until startAndWire.
export function clientStillConnected(ws: WebSocket, tag: string, sessionId: string, early: EarlyFrames, onAbandon?: () => void): boolean {
  if (ws.readyState === ws.OPEN) return true;
  console.log(`[ws/${tag}] client left before spawn — abandoning ${sessionId}`);
  finishPendingTerminalLaunch(sessionId);
  onAbandon?.();
  early.discard();
  return false;
}

// Launcher terminal (?launcher=<index>&cwd=<dir>, ?session=<id> to reattach): run a
// configured launch command as a persistent, reattachable PTY. Reuses the /ws session
// viewer transport (attach + detach + release) but with no hooks/transcript,
// and is marked a dev-terminal session so it stays out of the chat sidebar.
async function handleLaunchConnection(deps: WsRouteDeps, ws: WebSocket, req: WsUpgradeRequest) {
  const { url, requested, cwd, unusable, size } = wsConnectionContext(req);
  if (await refuseUnusableWorkspace(ws, "launch", unusable, requested)) return;
  const index = parseIndexParam(url.searchParams.get("launcher"));
  const shell = url.searchParams.get("shell") === "1";

  const resolved = await resolveLaunchSession(deps, requested, index, shell);
  if (!resolved) return closeWithError(ws, "Launcher not found — check Settings → Launch commands.");
  const { sessionId, viewer, command, core } = resolved;
  const effectiveCwd = core?.cwd || cwd;
  // A launcher is a command line, so the limit follows what it RUNS: a launcher configured as
  // `codex` is the agent toggle by another name and is held to the same rule, while `yarn dev` or
  // a shell is not an agent editing the tree and stays free (see launcherRunsAgent).
  const early = await admitAgentSession(ws, "launch", {
    requested: core?.id ?? requested,
    sessionId,
    viewer,
    cwd: effectiveCwd,
    worktreeLimited: launcherRunsAgent(command),
  });
  if (!early) return;

  // A launcher that runs codex gets the directory's registered tool groups too. The chip and the
  // agent toggle land in the same cell and look the same, so a Canvas that lights up for one and
  // never for the other reads as a broken feature. Only for a spawn, and only for codex — every
  // other command is passed through untouched (see launcher-gui-mcp.ts).
  const groups = core ? [] : await registeredGuiMcpGroups(effectiveCwd, TOOL_GROUPS).catch(() => []);
  const launchCommand = launcherCommandWithGuiMcp(command, codexGuiMcpServers({ sessionId, port: PORT, groups, allTools: false }), process.platform);
  if (!clientStillConnected(ws, "launch", sessionId, early)) return;

  // A launcher runs the user's own command line, so there is no binary pre-flight — but its cwd
  // is checked like every other spawn's, and that refusal is already a sentence.
  const startFailureMessage = startFailureMessageFor("the launch command");
  startAndWire(deps, ws, { id: sessionId, tag: "launch", early, startFailureMessage, stopLifecycleOnStartFailure: !core, size }, () =>
    startLaunchEntry(deps, ws, { sessionId, viewer, command: launchCommand, cwd: effectiveCwd, coreSessionExists: !!core }),
  );
}

// codex terminal (?cwd=<dir>, ?session=<id> to reattach/resume). ?gui=0 (grid dev terminal) runs
// codex without the GUI MCP and keeps it out of the sidebar; absent (single view) attaches the GUI
// MCP so codex drives the GUI panel like claude.
async function handleCodexConnection(deps: WsRouteDeps, ws: WebSocket, req: WsUpgradeRequest) {
  const { url, requested, cwd, unusable, size } = wsConnectionContext(req);
  if (await refuseUnusableWorkspace(ws, "codex", unusable, requested)) return;
  const attachGuiMcp = url.searchParams.get("gui") !== "0";

  const { sessionId, viewer, resumeRolloutId, core } = await resolveCodexSession(requested);
  const effectiveCwd = core?.cwd || cwd;
  const early = await admitAgentSession(ws, "codex", {
    requested: core?.id ?? requested,
    sessionId,
    viewer,
    cwd: effectiveCwd,
  });
  if (!early) return;

  // A grid cell's GUI tools are whatever its DIRECTORY registered — the same switches claude's
  // cells read, in the same file. claude picks them up itself; codex is handed resolved URLs at
  // spawn, so the answer has to be read here, before the pty exists. Only for a spawn: a reattach
  // keeps the tools its running process was started with.
  const mcpGroups = !attachGuiMcp && !core ? await registeredGuiMcpGroups(effectiveCwd, TOOL_GROUPS).catch(() => []) : [];
  if (!clientStillConnected(ws, "codex", sessionId, early)) return;

  const startFailureMessage = startFailureMessageFor("codex");
  startAndWire(deps, ws, { id: sessionId, tag: "codex", early, startFailureMessage, stopLifecycleOnStartFailure: !core, size }, () =>
    startCodexEntry(deps, ws, { sessionId, viewer, resumeRolloutId, cwd: effectiveCwd, attachGuiMcp, mcpGroups, coreSessionExists: !!core }),
  );
}

async function resolveAntigravitySession(requested: string | null): Promise<{
  sessionId: string;
  viewer: PtyEntry | undefined;
  resumeConversationId: string | null;
  core: CoreSession | null;
}> {
  const core = await requestedCoreSession(requested);
  const viewer = core ? viewerPtys.get(core.id) : undefined;
  // The same rule codex resumes by, including the part that is easy to drop: the key is only
  // treated as a conversation id when a conversation by that name EXISTS. Without the check every
  // key resumes, which means a stale one is handed to `agy --conversation` — agy answers a
  // conversation it cannot find by starting a fresh one, silently, under the old session's id.
  const resumeConversationId = agentResumeId(requested, {
    mappedId: core?.resumeSource ?? null,
    conversationExists: () => !!requested && antigravityConversationExists(antigravityBrainRoot(), requested),
    coreExists: !!core,
  });
  const { sessionId } = resolveReattachableId(core?.id ?? requested, { coreExists: !!core, hasViewer: !!viewer }, randomUUID);
  return { sessionId, viewer, resumeConversationId, core };
}

interface AntigravityStart {
  sessionId: string;
  viewer: PtyEntry | undefined;
  resumeConversationId: string | null;
  cwd: string;
  attachGuiMcp: boolean;
  mcpGroups: readonly ToolGroup[];
  coreSessionExists: boolean;
}

// Reattach or spawn, as ONE function handed to startAndWire — the reattach must not take a
// shortcut around it. `reattachPty` only swaps the socket and replays the buffer; returning early
// on it left a reloaded terminal printing output while ignoring every keystroke, and never
// detaching or releasing when the socket closed.
function startAntigravityEntry(deps: WsRouteDeps, ws: WebSocket, start: AntigravityStart): PtyEntry {
  const { sessionId, resumeConversationId, cwd, attachGuiMcp, mcpGroups, coreSessionExists } = start;
  const viewer = viewerPtys.get(sessionId);
  const entry = viewer
    ? attachViewer(deps, viewer, ws, sessionId)
    : deps.spawnAntigravityPty(sessionId, ws, resumeConversationId, cwd, { mcpGroups, coreSessionExists });
  // Single view (gui) = the attached session IS the actively-viewed pane. A grid dev-terminal
  // cell (gui=0) is only "viewed" once focused, and says so with a `view` frame.
  entry.active = attachGuiMcp;
  return entry;
}

// antigravity terminal (?cwd=<dir>, ?session=<id> to reattach/resume). Unlike claude and codex
// there is no per-session GUI MCP surface to attach or withhold: agy reads its servers from a file
// in the DIRECTORY, so every session there reaches whatever that directory registered — `?gui=0`
// only keeps a grid dev terminal out of the sidebar.
async function handleAntigravityConnection(deps: WsRouteDeps, ws: WebSocket, req: WsUpgradeRequest) {
  const { url, requested, cwd, unusable, size } = wsConnectionContext(req);
  if (await refuseUnusableWorkspace(ws, "antigravity", unusable, requested)) return;
  const attachGuiMcp = url.searchParams.get("gui") !== "0";
  const { sessionId, viewer, resumeConversationId, core } = await resolveAntigravitySession(requested);
  const effectiveCwd = core?.cwd || cwd;
  const early = await admitAgentSession(ws, "antigravity", {
    requested: core?.id ?? requested,
    sessionId,
    viewer,
    cwd: effectiveCwd,
  });
  if (!early) return;

  // The directory's registered groups, read here because the lookup reads Claude Code's config
  // files and the spawner is sync. Only for a SPAWN: a reattach keeps the tools its running
  // process was started with, and rewriting the shared file on a reattach would speak for every
  // other session in the directory.
  const mcpGroups = core ? [] : await registeredGuiMcpGroups(effectiveCwd, TOOL_GROUPS).catch(() => []);
  if (!clientStillConnected(ws, "antigravity", sessionId, early)) return;
  // The reattach goes THROUGH startAndWire like the spawn, not around it: reattachPty only swaps
  // the socket and replays the buffer, so returning early here left a reloaded terminal printing
  // output while ignoring every keystroke, and never detaching or releasing on close.
  const startFailureMessage = startFailureMessageFor("Antigravity");
  startAndWire(deps, ws, { id: sessionId, tag: "antigravity", early, startFailureMessage, stopLifecycleOnStartFailure: !core, size }, () =>
    startAntigravityEntry(deps, ws, {
      sessionId,
      viewer,
      resumeConversationId,
      cwd: effectiveCwd,
      attachGuiMcp,
      mcpGroups,
      coreSessionExists: !!core,
    }),
  );
}

export function mountTerminalWebSockets(deps: WsRouteDeps) {
  // Terminal WebSocket. Uses noServer + manual upgrade routing so it shares the
  // HTTP server with socket.io (the pub/sub at /ws/pubsub) without the two
  // libraries fighting over the "upgrade" event.
  const wss = new WebSocketServer({ noServer: true });
  // Command terminals (the grid's Run menu) get their own WS so the plain-command
  // PTY relay stays clear of the session/hook/transcript machinery on /ws.
  const runWss = new WebSocketServer({ noServer: true });
  // Launcher terminals (a plain shell / codex / any configured command) get their own WS
  // too. Unlike /ws/run these are PERSISTENT & reattachable (they share the /ws session
  // viewer transport — viewerPtys map, attach/detach/release) but carry no Claude hooks/transcript.
  const runLaunchWss = new WebSocketServer({ noServer: true });
  // First-class codex sessions — persistent + reattachable like /ws/launch, but running codex
  // with session discovery + resume. Its own endpoint so /ws stays claude-only.
  const runCodexWss = new WebSocketServer({ noServer: true });
  // First-class Antigravity sessions — persistent + reattachable like /ws/launch, but running agy.
  const runAntigravityWss = new WebSocketServer({ noServer: true });
  const serverFor: Record<TerminalWsKind, WebSocketServer> = {
    claude: wss,
    run: runWss,
    launch: runLaunchWss,
    codex: runCodexWss,
    antigravity: runAntigravityWss,
  };
  deps.server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const kind = terminalWsKind(stripBasePath(pathname, MULMOTERMINAL_BASE_PATH));
    // Not ours (e.g. /ws/pubsub) — leave it for socket.io's own upgrade handler. This
    // returns BEFORE the origin check on purpose: rejecting here would destroy a socket
    // socket.io is entitled to.
    if (!kind) return;
    const target = serverFor[kind];
    if (!deps.isAllowedOrigin(req.headers.origin, req.socket?.remoteAddress)) {
      console.warn(`[ws] rejected cross-origin upgrade from ${req.headers.origin}`);
      socket.destroy();
      return;
    }
    target.handleUpgrade(req, socket, head, (ws) => {
      attachSocketErrorLogger(ws, kind);
      target.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => void withHistoryAdmissionClaim(requestedReference(req), () => handleClaudeConnection(deps, ws, req)));
  runWss.on("connection", (ws, req) => handleRunConnection(deps, ws, req));
  runLaunchWss.on("connection", (ws, req) => void handleLaunchConnection(deps, ws, req));
  runCodexWss.on("connection", (ws, req) => void withHistoryAdmissionClaim(requestedReference(req), () => handleCodexConnection(deps, ws, req)));
  runAntigravityWss.on("connection", (ws, req) => void withHistoryAdmissionClaim(requestedReference(req), () => handleAntigravityConnection(deps, ws, req)));

  return {
    close() {
      for (const server of Object.values(serverFor)) {
        for (const client of server.clients) client.close(1001, "server shutdown");
        server.close();
      }
    },
  };
}
