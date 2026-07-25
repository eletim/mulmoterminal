// Turns the command channel going offline into something the user actually sees (#823).
//
// Until now the only trace of a dropped channel was one console.warn in the server log,
// so the first sign was the phone failing to connect. The bell fans out over pubsub, so
// every open tab lights up the moment it happens — no polling involved.
//
// Only the give-up transition publishes: a blip the runner heals by itself is not worth
// a notification, and one per retry would be noise.
import type { RunnerHealth } from "../../../common/remoteHostHealth.js";

const PLUGIN_PKG = "remote-host";
const TITLE = "Remote host disconnected";

export interface HealthNoticeDeps {
  publish: (input: { pluginPkg: string; severity: "urgent"; title: string; body: string }) => Promise<{ id: string }>;
  clear: (entryId: string) => Promise<void>;
  /** This plugin's live entries. Asked rather than remembered, so a notice raised before a
   *  restart is still found and cleared by the process that comes back. */
  list: (pluginPkg: string) => Promise<{ id: string }[]>;
  log: { warn: (msg: string) => void };
}

const bodyFor = (health: RunnerHealth): string => {
  const reason = health.lastError ? ` Last error: ${health.lastError}.` : "";
  return `Your phone can no longer reach this Mac.${reason} Reconnect from the Remote host menu in the toolbar.`;
};

/** Returns a health listener that keeps at most one notice alive: published when the
 *  channel gives up, cleared when it comes back. Failures are logged, never thrown —
 *  a notifier problem must not take the runner down with it. */
export function createHealthNotice(deps: HealthNoticeDeps): (health: RunnerHealth) => void {
  // The states arrive synchronously while publish/clear are async, so they are applied in
  // order — otherwise a fast offline→online pair could clear before the entry exists and
  // leave the notice up for good.
  let queue: Promise<void> = Promise.resolve();

  const publishNotice = async (health: RunnerHealth): Promise<void> => {
    const existing = await deps.list(PLUGIN_PKG);
    if (existing.length > 0) return;
    await deps.publish({ pluginPkg: PLUGIN_PKG, severity: "urgent", title: TITLE, body: bodyFor(health) });
  };

  const clearNotice = async (): Promise<void> => {
    const entries = await deps.list(PLUGIN_PKG);
    await Promise.all(entries.map((entry) => deps.clear(entry.id)));
  };

  return (health: RunnerHealth) => {
    if (health.state === "reconnecting") return;
    const step = health.state === "offline" ? () => publishNotice(health) : clearNotice;
    queue = queue.then(step).catch((err) => deps.log.warn(`health notice failed: ${err instanceof Error ? err.message : String(err)}`));
  };
}
