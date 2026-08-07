import { isLaunchAgent, type LaunchAgent } from "../../common/launchAgent";

export const REMEMBERED_LAUNCH_AGENT_KEY = "mt-new-terminal-agent";
export const DEFAULT_LAUNCH_AGENT: LaunchAgent = "claude";

export function readRememberedLaunchAgent(fallback: LaunchAgent = DEFAULT_LAUNCH_AGENT): LaunchAgent {
  try {
    const stored = localStorage.getItem(REMEMBERED_LAUNCH_AGENT_KEY);
    return isLaunchAgent(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function rememberLaunchAgent(agent: LaunchAgent): void {
  try {
    localStorage.setItem(REMEMBERED_LAUNCH_AGENT_KEY, agent);
  } catch {
    // best-effort per-browser preference
  }
}
