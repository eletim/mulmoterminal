// What GET /api/launch-options answers with: the backends this server can actually reach
// right now, each with the models it can run (#584). The wire shape lives here so the
// server's decision (config/launch-options.ts) and the client's picker can't drift.
import type { ModelPreset } from "./modelPresets.js";

export interface LaunchProviderOption {
  id: string;
  label: string;
  // False when this server cannot start a session on it as configured.
  ready: boolean;
  // Why not, in resolveProvider's own words. Absent when ready.
  reason?: string;
  // The env var this provider's key is read from — the help needs to name it, and it is
  // the NAME, never the value.
  tokenEnv: string;
  models: ModelPreset[];
}

export interface LaunchOptions {
  providers: LaunchProviderOption[];
  // True when at least one provider can be launched on. The picker hides itself otherwise:
  // with no reachable backend there is nothing to choose between, only setup to explain.
  anyReady: boolean;
}
