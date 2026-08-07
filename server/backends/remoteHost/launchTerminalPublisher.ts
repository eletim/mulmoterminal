import { LAUNCH_TERMINAL_CHANNEL } from "../../../common/launchAgent.js";
import { decideLaunchTerminal, decideLaunchTerminalAtCwd, NO_BROWSER_ERROR, type LaunchTerminalRequest } from "./launchTerminal.js";

export interface LaunchTerminalPublisher {
  subscriberCount(channel: string): number;
  publishToOne(channel: string, data: unknown): boolean;
}

export function createLaunchTerminalPublisher(deps: { pubsub: LaunchTerminalPublisher | null; cwdOfSession: (sessionId: string) => string | null }) {
  const listenerCount = () => deps.pubsub?.subscriberCount(LAUNCH_TERMINAL_CHANNEL) ?? 0;
  const publish = (request: LaunchTerminalRequest) =>
    (deps.pubsub?.publishToOne(LAUNCH_TERMINAL_CHANNEL, request) ?? false) ? { ok: true as const } : { ok: false as const, error: NO_BROWSER_ERROR };

  return {
    fromSession(agent: unknown, sessionId: unknown) {
      const decision = decideLaunchTerminal({ agent, sessionId, cwdOf: deps.cwdOfSession, listenerCount: listenerCount() });
      return decision.ok ? publish(decision.request) : decision;
    },
    atCwd(agent: unknown, cwd: string) {
      const decision = decideLaunchTerminalAtCwd({ agent, cwd, listenerCount: listenerCount() });
      return decision.ok ? publish(decision.request) : decision;
    },
  };
}
