// Whether work on one repo can start here, decided from the repo -> clone answer alone (#1173).
// Pure, because the three outcomes are the whole behaviour: on the desktop they are a button, a
// menu, or a disabled button that says why (IssueStartButton.vue).
//
// In `common/` because BOTH hosts decide from it: the phone asks the same question over the remote
// command channel (#1184) and must reach the same answer — with one difference it makes itself,
// not one encoded here. It cannot offer the menu (the phone never picks a directory, see
// docs/remote-host-protocol.md), so it refuses `choose` where the desktop opens it.
import type { RepoDirs } from "./repoDirs";
import { GITHUB_HOST, GITLAB_HOST, parseRepoEntry } from "./repoEntry";

// Where work can be STARTED — the issue is read and a worktree cut. A host that is merely listable
// still refuses, and says which host it is rather than blaming a missing clone (#981).
const STARTABLE_HOSTS: ReadonlySet<string> = new Set([GITHUB_HOST, GITLAB_HOST]);

/** The hosts named in a refusal, read off the set rather than written out beside it — a hardcoded
 *  "github.com only" survived GitLab becoming startable and told users the opposite of the truth
 *  (Codex review). Exported so the phone's refusal says the same thing. */
export const startableHosts = (): string => [...STARTABLE_HOSTS].join(" and ");

export type IssueStartPlan =
  /** No clone of this repo on this machine, so there is nowhere for the work to happen. */
  | { kind: "no-clone" }
  /** The repo is on a forge whose issues can be LISTED but not started from (#981). Distinct from
   *  `no-clone`, which would send the reader off to add a clone that would not help. */
  | { kind: "unsupported-forge"; host: string }
  /** Exactly one answer — either recorded, or the only candidate. One click starts. */
  | { kind: "ready"; dir: string }
  /** Several clones and nothing recorded yet: the user picks, and the pick is remembered. */
  | { kind: "choose"; dirs: RepoDirs["dirs"] };

/** A plan that cannot start work as it stands. Named so a caller that has already narrowed to it
 *  can be given a sentence rather than a nullable one — see the phone's refusal (#1184). */
export type BlockedIssueStartPlan = Exclude<IssueStartPlan, { kind: "ready" }>;

// `repo` is REQUIRED, not optional, even though only one branch reads it: a caller that omitted it
// would get `no-clone` for a GitLab repo, which is the exact wrong answer this parameter was added
// to fix. Making the compiler ask for it is what stops that coming back.
export function issueStartPlan(entry: RepoDirs | undefined, repo: string): IssueStartPlan {
  // Checked before the clone list, because a GitLab repo has no entry there and would otherwise
  // read as "no clone" — a reason that is not true and points at the wrong fix.
  const parsed = parseRepoEntry(repo);
  if (parsed && !STARTABLE_HOSTS.has(parsed.host)) return { kind: "unsupported-forge", host: parsed.host };
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
  if (plan.kind === "unsupported-forge") return `Starting work supports ${startableHosts()} — ${plan.host} issues are listed here, not started from`;
  return plan.kind === "no-clone" ? `No local clone of ${repo} — add one to your directory presets to start work here` : null;
}
