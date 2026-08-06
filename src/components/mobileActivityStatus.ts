// The status word MobileTerminalPage.vue shows next to a session's existing live/detached badge
// (/mobile/terminals). Built directly on attentionStatus.ts's activityStatus() — the same
// function the desktop roster, sidebar and tab bar use to split blocked/done/working/idle — so
// the phone never disagrees with the desktop about what a row means. The only thing added here is
// naming the work phase (planning / implementing / plain running) while `working`, since the
// phone has room to say more than the desktop's single "working" word.
//
// `waiting` MUST be checked ahead of `working`: Claude/Codex can set both at once (a permission
// prompt or question mid-turn — server/session/activity-hook.ts's Notification event — arrives as
// `{ working: true, waiting: true, event: "Notification" }`), and that combination means the
// agent is blocked on the user, not merely busy. activityStatus() already encodes that ordering
// (`if (waiting) return …; if (working) return "working";`), which is why this function defers to
// it instead of re-deriving the same decision.
import { activityStatus } from "./attentionStatus";
import { isWorkPhase, type WorkPhase } from "./rosterPhase";

export { isWorkPhase, type WorkPhase };

export type MobileActivityStatus = "planning" | "implementing" | "running" | "needs input" | "done" | "idle";

export function mobileActivityStatus(working: boolean, waiting: boolean, event: string | null, workPhase: WorkPhase | null): MobileActivityStatus {
  const status = activityStatus(working, waiting, event);

  if (status === "blocked") return "needs input";
  if (status === "done") return "done";
  if (status === "idle") return "idle";

  // status === "working" here — name the phase the desktop roster doesn't split out.
  if (workPhase === "planning") return "planning";
  if (workPhase === "implementing") return "implementing";
  return "running";
}
