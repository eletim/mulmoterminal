import type { CoreSession } from "../session/core-session-adapter.js";
import { normalizeActivity } from "../session/activity-transition.js";
import type { Activity } from "../session/types.js";
import type { WorkPhase } from "../session/workPhase.js";

export interface OrchestratorStatusDeps {
  getSession: (id: string) => Promise<CoreSession | null>;
  hasViewer: (id: string) => boolean;
  activityOf: (id: string) => Activity | undefined;
  workPhaseOf: (id: string) => WorkPhase | null;
}

const coreLifecycle = (session: Pick<CoreSession, "exited" | "attached">) => {
  if (session.exited) return "stopped" as const;
  return session.attached ? ("live" as const) : ("detached" as const);
};

/** Project Core-native lifecycle plus optional UI state. Activity never gates Core operations. */
export function createOrchestratorStatusReader(deps: OrchestratorStatusDeps) {
  return async (id: string) => {
    const session = await deps.getSession(id);
    if (!session) return null;
    const inputAvailable = !session.exited;
    const currentActivity = session.exited ? undefined : deps.activityOf(id);
    return {
      ok: true as const,
      sessionId: session.id,
      agent: session.agent,
      cwd: session.cwd,
      lifecycle: coreLifecycle(session),
      runtime: { pty: deps.hasViewer(id), tmux: true, attached: session.attached },
      activity: { ...normalizeActivity(currentActivity), at: currentActivity?.at ?? 0, workPhase: session.exited ? null : deps.workPhaseOf(id) },
      input: inputAvailable
        ? { available: true, ready: true, known: true, source: "core", checkedAt: Date.now(), reason: "Core session is running" }
        : { available: false, ready: false, known: true, source: "unavailable", checkedAt: Date.now(), reason: "Core session has exited" },
      inputAvailable,
      readyForInput: inputAvailable,
    };
  };
}
