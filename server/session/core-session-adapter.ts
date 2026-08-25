import { spawnSync } from "node:child_process";
import { SessionCore, SessionNotFoundError, type CreateSessionOptions, type Session } from "tmux-session-core-ts";
import { isLaunchAgent, type LaunchAgent } from "../../common/launchAgent.js";
import { CORE_TMUX_SERVER } from "./core-session-config.js";

const AGENT_METADATA_KEY = "agent";
const TITLE_METADATA_KEY = "title";
const MEMO_METADATA_KEY = "memo";
// tmux clears pane_current_path once a remain-on-exit pane is dead. This is the one native
// session fact that must be copied so an exited session can still be reconstructed after restart.
const CWD_METADATA_KEY = "cwd";

export interface CoreSession extends Session {
  agent: LaunchAgent;
  title: string | null;
  memo: string | null;
}

export interface CreateCoreSessionOptions extends Omit<CreateSessionOptions, "id"> {
  id: string;
  agent: LaunchAgent;
  title?: string;
  memo?: string;
}

export interface CoreSessionAdapterOptions {
  core?: SessionCore;
  serverName?: string;
  createSync?: (options: CreateCoreSessionOptions, environment: NodeJS.ProcessEnv, serverName: string) => void;
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
  const { agent, title, memo, ...session } = options;
  const metadata = {
    [AGENT_METADATA_KEY]: agent,
    [CWD_METADATA_KEY]: session.cwd,
    ...(title ? { [TITLE_METADATA_KEY]: title } : {}),
    ...(memo ? { [MEMO_METADATA_KEY]: memo } : {}),
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

  constructor(options: CoreSessionAdapterOptions = {}) {
    this.serverName = options.serverName ?? CORE_TMUX_SERVER;
    this.core = options.core ?? new SessionCore({ serverName: this.serverName });
    this.createSyncImpl = options.createSync ?? defaultCreateSync;
  }

  createSync(options: CreateCoreSessionOptions, environment: NodeJS.ProcessEnv): void {
    this.createSyncImpl(options, environment, this.serverName);
  }

  async create(options: CreateCoreSessionOptions): Promise<CoreSession> {
    const { agent, title, memo, ...session } = options;
    let created = false;
    try {
      const native = await this.core.create(session);
      created = true;
      await this.core.setMetadata(session.id, AGENT_METADATA_KEY, agent);
      await this.core.setMetadata(session.id, CWD_METADATA_KEY, session.cwd);
      if (title) await this.core.setMetadata(session.id, TITLE_METADATA_KEY, title);
      if (memo) await this.core.setMetadata(session.id, MEMO_METADATA_KEY, memo);
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

  async get(id: string): Promise<CoreSession> {
    return this.withMetadata(await this.core.get(id));
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

  async setTitle(id: string, title: string): Promise<void> {
    await this.setOptionalMetadata(id, TITLE_METADATA_KEY, title);
  }

  async setMemo(id: string, memo: string): Promise<void> {
    await this.setOptionalMetadata(id, MEMO_METADATA_KEY, memo);
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
    };
  }

  private async setOptionalMetadata(id: string, key: string, value: string): Promise<void> {
    if (value === "") {
      await this.core.deleteMetadata(id, key);
      return;
    }
    await this.core.setMetadata(id, key, value);
  }
}

export const coreSessions = new CoreSessionAdapter();
export { SessionNotFoundError as CoreSessionNotFoundError };
