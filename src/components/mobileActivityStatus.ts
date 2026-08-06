// The status word MobileTerminalPage.vue shows next to a session's existing live/detached badge
// (/mobile/terminals). Computed from the same working/waiting/event/workPhase vocabulary the
// desktop roster reads (attentionStatus.ts's four-way AttentionStatus, rosterPhase.ts's
// planning/implementing split) — but as its OWN pure function rather than a shared one, because
// the phone needs a finer label set than either: a working session names its phase (planning /
// implementing / plain running), and a waiting one is split three ways instead of two (blocked vs
// done), matching the exact wording product asked for (#see the local-mobile-session-activity PR).
//
// In practice only "Notification" and "Stop" ever accompany `waiting: true` (server/session/
// activity-hook.ts, codex-activity.ts's HOOK_EVENT_FOR) — the plain "waiting" branch below is a
// forward-compatible fallback for an event this vocabulary doesn't know yet, not a state seen
// today. Until such an event exists this reads identically to the desktop roster's binary
// blocked/done split.
import { isWorkPhase, type WorkPhase } from "./rosterPhase";

export { isWorkPhase, type WorkPhase };

export type MobileActivityStatus = "planning" | "implementing" | "running" | "needs input" | "done" | "waiting" | "idle";

export function mobileActivityStatus(working: boolean, waiting: boolean, event: string | null, workPhase: WorkPhase | null): MobileActivityStatus {
  if (working) {
    if (workPhase === "planning") return "planning";
    if (workPhase === "implementing") return "implementing";
    return "running";
  }
  if (waiting && event === "Notification") return "needs input";
  if (waiting && event === "Stop") return "done";
  if (waiting) return "waiting";
  return "idle";
}
