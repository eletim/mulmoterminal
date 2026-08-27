// What index.ts still owns after the PTY machinery moved out (#548 step 3c). The json
// builders read config it holds; viewer release and UI activity have separate owners, so both
// arrive as explicit dependencies rather than being hidden behind a lifecycle manager.
import type { PtyEntry } from "./types.js";

export interface SpawnDeps {
  claudeBin: string;
  codexBin: string;
  codexModel: string | null;
  antigravityBin: string;
  antigravityModel: string | null;
  permissionMode: string;
  /** Tool names auto-allowed for every session, already comma-joined. */
  guiMcpTools: string;
  // The --allowedTools list for a GRID cell, whose GUI tools come from the user's own
  // per-folder MCP config rather than from --mcp-config. See GRID_MCP_TOOLS in index.ts.
  gridMcpTools: string;
  /** Bytes of pty output kept for a client that reattaches later. */
  outputBufferLimit: number;
  hookSettingsJson: (host: string, sessionId: string, env?: Record<string, string>) => string;
  mcpConfigJson: (sessionId: string, host?: string) => string;
  releaseViewer: (id: string, expected?: PtyEntry) => void;
  setWorking: (id: string, working: boolean, event?: string) => void;
  /** Needed alongside setWorking because a finished codex turn flags the cell for attention,
   *  exactly as claude's Stop hook does — see codex-activity-watch. */
  setWaiting: (id: string, waiting: boolean, event?: string) => void;
  publishActivity: (id: string) => void;
  /** Which port this host's UI answers on, so a codex completion notification can open it. */
  uiPort: string;
  /** Surface a brand-new session in the sidebar before it is persisted. */
  publishSessionCreated: (sessionId: string) => void;
  /** End UI activity when Core reports process exit. Membership remains in Core. */
  endSessionActivity: (sessionId: string) => void;
}
