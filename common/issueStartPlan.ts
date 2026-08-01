// Whether work on one repo can start here, decided from the repo -> clone answer alone (#1173).
// Pure, because the three outcomes are the whole behaviour: on the desktop they are a button, a
// menu, or a disabled button that says why (IssueStartButton.vue).
//
// In `common/` because BOTH hosts decide from it: the phone asks the same question over the remote
// command channel (#1184) and must reach the same answer — with one difference it makes itself,
// not one encoded here. It cannot offer the menu (the phone never picks a directory, see
// docs/remote-host-protocol.md), so it refuses `choose` where the desktop opens it.
import type { RepoDirs } from "./repoDirs";

export type IssueStartPlan =
  /** No clone of this repo on this machine, so there is nowhere for the work to happen. */
  | { kind: "no-clone" }
  /** Exactly one answer — either recorded, or the only candidate. One click starts. */
  | { kind: "ready"; dir: string }
  /** Several clones and nothing recorded yet: the user picks, and the pick is remembered. */
  | { kind: "choose"; dirs: RepoDirs["dirs"] };

/** A plan that cannot start work as it stands. Named so a caller that has already narrowed to it
 *  can be given a sentence rather than a nullable one — see the phone's refusal (#1184). */
export type BlockedIssueStartPlan = Exclude<IssueStartPlan, { kind: "ready" }>;

export function issueStartPlan(entry: RepoDirs | undefined): IssueStartPlan {
  const dirs = entry?.dirs ?? [];
  if (dirs.length === 0) return { kind: "no-clone" };
  // A recording wins even when the repo has one clone: it is still the same answer, and treating
  // the two cases the same keeps "recorded" from being a state the UI has to distinguish.
  const recorded = entry?.primary;
  if (recorded) return { kind: "ready", dir: recorded };
  if (dirs.length === 1) return { kind: "ready", dir: dirs[0].path };
  return { kind: "choose", dirs };
}

/** Why the control is disabled, for the row's title text. Null when it is not disabled. */
export function issueStartBlockedReason(plan: IssueStartPlan, repo: string): string | null {
  return plan.kind === "no-clone" ? `No local clone of ${repo} — add one to your directory presets to start work here` : null;
}
