import { spawnSync } from "node:child_process";
import { SessionCore, SessionNotFoundError, type CreateSessionOptions, type Session } from "tmux-session-core-ts";
import { isLaunchAgent, type LaunchAgent } from "../../common/launchAgent.js";
import { CORE_TMUX_SERVER } from "./core-session-config.js";

const AGENT_METADATA_KEY = "agent";
const TITLE_METADATA_KEY = "title";
const MEMO_METADATA_KEY = "memo";
const RESUME_SOURCE_METADATA_KEY = "resume-source";
const VISIBILITY_METADATA_KEY = "visibility";
// tmux clears pane_current_path once a remain-on-exit pane is dead. This is the one native
// session fact that must be copied so an exited session can still be reconstructed after restart.
const CWD_METADATA_KEY = "cwd";

export interface CoreSession extends Session {
  agent: LaunchAgent;
  title: string | null;
  memo: string | null;
  resumeSource: string | null;
  visibility: CoreSessionVisibility;
}

export type CoreSessionVisibility = "normal" | "background" | "internal";

export interface CreateCoreSessionOptions extends Omit<CreateSessionOptions, "id"> {
  id: string;
  agent: LaunchAgent;
  title?: string;
  memo?: string;
  resumeSource?: string;
  visibility?: CoreSessionVisibility;
}

export interface CoreSessionAdapterOptions {
  core?: SessionCore;
  serverName?: string;
  createSync?: (options: CreateCoreSessionOptions, environment: NodeJS.ProcessEnv, serverName: string) => void;
}

export interface CoreSessionExit {
  exitCode: number | null;
}

const syncCreateScript = String.raw`
import { SessionCore } from "tmux-session-core-ts";
const payload = JSON.parse(process.env.MULMOTERMINAL_CORE_CREATE_PAYLOAD);
const core = new SessionCore({ serverName: payload.serverName });
let created = false;
try {
  await core.create(payload.session);
  created = true;
  for (const [key, value] of Object.entries(payload.metadata)) {
    await core.setMetadata(payload.session.id, key, value);
  }
} catch (error) {
  if (created) await core.delete(payload.session.id).catch(() => undefined);
  throw error;
}
`;

function defaultCreateSync(options: CreateCoreSessionOptions, environment: NodeJS.ProcessEnv, serverName: string): void {
  const { agent, title, memo, resumeSource, visibility = "normal", ...session } = options;
  const metadata = {
    [AGENT_METADATA_KEY]: agent,
    [CWD_METADATA_KEY]: session.cwd,
    ...(title ? { [TITLE_METADATA_KEY]: title } : {}),
    ...(memo ? { [MEMO_METADATA_KEY]: memo } : {}),
    ...(resumeSource ? { [RESUME_SOURCE_METADATA_KEY]: resumeSource } : {}),
    [VISIBILITY_METADATA_KEY]: visibility,
  };
  const payload = JSON.stringify({ serverName, session, metadata });
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", syncCreateScript], {
    cwd: process.cwd(),
    env: { ...environment, MULMOTERMINAL_CORE_CREATE_PAYLOAD: payload },
    encoding: "utf8",
  });
  if (result.status === 0) return;
  const reason = result.stderr.trim() || result.error?.message || `child exited ${String(result.status)}`;
  throw new Error(`Core session create failed: ${reason}`);
}

export class CoreSessionAdapter {
  readonly serverName: string;
  private readonly core: SessionCore;
  private readonly createSyncImpl: NonNullable<CoreSessionAdapterOptions["createSync"]>;
  private readonly inputTails = new Map<string, Promise<void>>();
  private readonly exitWatchers = new Map<string, (event: CoreSessionExit) => void>();
  private exitPollTimer: ReturnType<typeof setTimeout> | undefined;
  private exitPollMs = 250;
  private exitPollInFlight = false;

  constructor(options: CoreSessionAdapterOptions = {}) {
    this.serverName = options.serverName ?? CORE_TMUX_SERVER;
    this.core = options.core ?? new SessionCore({ serverName: this.serverName });
    this.createSyncImpl = options.createSync ?? defaultCreateSync;
  }

  createSync(options: CreateCoreSessionOptions, environment: NodeJS.ProcessEnv): void {
    this.createSyncImpl(options, environment, this.serverName);
  }

  async create(options: CreateCoreSessionOptions): Promise<CoreSession> {
    const { agent, title, memo, resumeSource, visibility = "normal", ...session } = options;
    let created = false;
    try {
      const native = await this.core.create(session);
      created = true;
      await this.core.setMetadata(session.id, AGENT_METADATA_KEY, agent);
      await this.core.setMetadata(session.id, CWD_METADATA_KEY, session.cwd);
      if (title) await this.core.setMetadata(session.id, TITLE_METADATA_KEY, title);
      if (memo) await this.core.setMetadata(session.id, MEMO_METADATA_KEY, memo);
      if (resumeSource) await this.core.setMetadata(session.id, RESUME_SOURCE_METADATA_KEY, resumeSource);
      await this.core.setMetadata(session.id, VISIBILITY_METADATA_KEY, visibility);
      return this.withMetadata(native);
    } catch (error) {
      if (created) await this.core.delete(session.id).catch(() => undefined);
      throw error;
    }
  }

  async list(): Promise<CoreSession[]> {
    const sessions = await this.core.list();
    return Promise.all(sessions.map((session) => this.withMetadata(session)));
  }

  /** Lightweight membership projection for file authorization. Live cwd comes from Core's
   * native list; only remain-on-exit panes whose native cwd is gone need one metadata read. */
  async listCwds(): Promise<string[]> {
    const sessions = await this.core.list();
    return Promise.all(sessions.map(async (session) => session.cwd || (await this.core.listMetadata(session.id))[CWD_METADATA_KEY] || ""));
  }

  async get(id: string): Promise<CoreSession> {
    return this.withMetadata(await this.core.get(id));
  }

  async find(id: string): Promise<CoreSession | null> {
    try {
      return await this.get(id);
    } catch (error) {
      if (error instanceof SessionNotFoundError) return null;
      throw error;
    }
  }

  /** Lightweight native lifecycle query. It deliberately avoids metadata reconstruction so
   * high-frequency activity/resume watchers issue only Core's membership lookup. */
  async isRunning(id: string): Promise<boolean> {
    try {
      return !(await this.core.get(id)).exited;
    } catch (error) {
      if (error instanceof SessionNotFoundError) return false;
      throw error;
    }
  }

  /** Resolve either current membership identity or the history identity it resumed. */
  async findByReference(id: string): Promise<CoreSession | null> {
    const direct = await this.find(id);
    if (direct) return direct;
    return (await this.list()).find((session) => session.resumeSource === id) ?? null;
  }

  async screen(id: string): Promise<string> {
    return this.core.screen(id);
  }

  async input(id: string, text: string): Promise<void> {
    const previous = this.inputTails.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.core.input(id, text, { submit: false }));
    this.inputTails.set(id, current);
    try {
      await current;
    } finally {
      if (this.inputTails.get(id) === current) this.inputTails.delete(id);
    }
  }

  async resize(id: string, cols: number, rows: number): Promise<void> {
    await this.core.resize(id, cols, rows);
  }

  async stop(id: string): Promise<void> {
    await this.core.stop(id);
  }

  async delete(id: string): Promise<void> {
    await this.core.delete(id);
  }

  /**
   * Observe remain-on-exit panes. Their tmux client stays attached after the child exits, so
   * node-pty cannot supply the lifecycle event MulmoTerminal needs for activity and hook cleanup.
   */
  watchExit(id: string, listener: (event: CoreSessionExit) => void, pollMs = 250): { dispose(): void } {
    this.exitWatchers.set(id, listener);
    this.exitPollMs = Math.min(this.exitPollMs, pollMs);
    void this.pollExits();
    return {
      dispose: () => {
        if (this.exitWatchers.get(id) === listener) this.exitWatchers.delete(id);
        if (this.exitWatchers.size === 0 && this.exitPollTimer) {
          clearTimeout(this.exitPollTimer);
          this.exitPollTimer = undefined;
        }
      },
    };
  }

  async setTitle(id: string, title: string): Promise<void> {
    await this.setOptionalMetadata(id, TITLE_METADATA_KEY, title);
  }

  async setMemo(id: string, memo: string): Promise<void> {
    await this.setOptionalMetadata(id, MEMO_METADATA_KEY, memo);
  }

  async setResumeSource(id: string, sourceId: string): Promise<void> {
    await this.core.setMetadata(id, RESUME_SOURCE_METADATA_KEY, sourceId);
  }

  async setVisibility(id: string, visibility: CoreSessionVisibility): Promise<void> {
    await this.core.setMetadata(id, VISIBILITY_METADATA_KEY, visibility);
  }

  private async withMetadata(session: Session): Promise<CoreSession> {
    const metadata = await this.core.listMetadata(session.id);
    const agent = isLaunchAgent(metadata[AGENT_METADATA_KEY]) ? metadata[AGENT_METADATA_KEY] : "shell";
    return {
      ...session,
      cwd: session.cwd || metadata[CWD_METADATA_KEY] || "",
      agent,
      title: metadata[TITLE_METADATA_KEY] || null,
      memo: metadata[MEMO_METADATA_KEY] || null,
      resumeSource: metadata[RESUME_SOURCE_METADATA_KEY] || null,
      visibility:
        metadata[VISIBILITY_METADATA_KEY] === "background" || metadata[VISIBILITY_METADATA_KEY] === "internal" ? metadata[VISIBILITY_METADATA_KEY] : "normal",
    };
  }

  private async setOptionalMetadata(id: string, key: string, value: string): Promise<void> {
    if (value === "") {
      await this.core.deleteMetadata(id, key);
      return;
    }
    await this.core.setMetadata(id, key, value);
  }

  private async pollExits(): Promise<void> {
    if (this.exitPollInFlight || this.exitWatchers.size === 0) return;
    this.exitPollInFlight = true;
    try {
      const sessions = await this.core.list();
      const memberIds = new Set(sessions.map((session) => session.id));
      // Explicit Delete is not a process-exit event. Drop observers for vanished membership
      // without notifying activity/process-exit consumers or retaining an idle poll forever.
      for (const id of this.exitWatchers.keys()) {
        if (!memberIds.has(id)) this.exitWatchers.delete(id);
      }
      for (const session of sessions) {
        if (!session.exited) continue;
        const listener = this.exitWatchers.get(session.id);
        if (!listener) continue;
        this.exitWatchers.delete(session.id);
        listener({ exitCode: session.exitCode });
      }
    } catch {
      // A transient tmux probe failure is retried. Absence never synthesizes a child exit.
    } finally {
      this.exitPollInFlight = false;
      if (this.exitWatchers.size > 0) {
        this.exitPollTimer = setTimeout(() => {
          this.exitPollTimer = undefined;
          void this.pollExits();
        }, this.exitPollMs);
        this.exitPollTimer.unref?.();
      }
    }
  }
}

export const coreSessions = new CoreSessionAdapter();
export { SessionNotFoundError as CoreSessionNotFoundError };
