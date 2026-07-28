// What a cell is working on, as it travels between the two sides: the branch's PR, its phase in
// the review loop, and the issue that PR closes. Shared because BOTH sides decide from it — the
// server derives it from `gh`, the client decides what the header chip shows — and it used to be
// two declarations with a "keep them in sync" comment on one of them (src/components/rosterPhase.ts).

// Ordered roughly along the lifecycle so the client can pick a colour/label per phase.
// `none` = no PR for this branch yet (still local work); `ready` = open, CI green, no
// changes requested — i.e. waiting to merge.
export type PrPhase = "none" | "draft" | "ci-failing" | "changes-requested" | "ci-running" | "ready" | "merged" | "closed";

export const PR_PHASES: readonly PrPhase[] = ["none", "draft", "ci-failing", "changes-requested", "ci-running", "ready", "merged", "closed"];

export const isPrPhase = (v: unknown): v is PrPhase => typeof v === "string" && (PR_PHASES as readonly string[]).includes(v);

// The /api/pr-phase response. `phase` and `prUrl` predate the rest and the roster reads them;
// the numbers are what lets a cell say WHICH work it is on rather than just how far along it is.
export interface WorkItem {
  phase: PrPhase;
  pr: number | null;
  prUrl: string | null;
  issue: number | null;
  issueUrl: string | null;
}

export const EMPTY_WORK_ITEM: Readonly<WorkItem> = { phase: "none", pr: null, prUrl: null, issue: null, issueUrl: null };

// GitHub's closing keywords, as GitHub itself matches them: any of these, then optional
// whitespace/colon, then #N. Anything else in the body is a mention, not a link — a PR that
// says "related to #12" is not working on #12.
// One character class for the separator, not `\s*:?\s+`: two adjacent whitespace quantifiers
// backtrack super-linearly on a long body, and a PR description is user input.
const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[:\s]+#(\d+)/i;

// The issue a PR body says it closes, or null. Deliberately blind to the full-URL form
// (`Fixes https://github.com/o/r/issues/12`): that can name ANOTHER repository, and a number
// shown next to this cell's PR has to belong to the same repo to be clickable and true.
export function issueRefFromPrBody(body: string | null | undefined): number | null {
  const found = typeof body === "string" ? CLOSING_KEYWORD.exec(body) : null;
  return found ? Number(found[1]) : null;
}

// A branch named after its issue the way this repo names them: `fix/966-preserve-unknown-keys`.
// Requires a type prefix and a hyphen after the digits, so `chore/dep-updates-20260728` is not
// read as issue #20260728.
const BRANCH_ISSUE = /^[a-z][a-z-]*\/(0|[1-9]\d*)-/;

// A CANDIDATE, never an answer: `release/2026-07-28-hotfix` yields 2026 here, and no pattern can
// tell that apart from a branch for issue #2026 — the year and the number have the same shape.
// The caller must confirm the issue exists before showing it, or a cell claims to be working on
// somebody else's issue. Named for the doubt so a call site can't forget it.
export function issueCandidateFromBranch(branch: string | null | undefined): number | null {
  const found = typeof branch === "string" ? BRANCH_ISSUE.exec(branch) : null;
  if (!found) return null;
  const n = Number(found[1]);
  return n > 0 ? n : null;
}
