// Turning what `glab` prints into the rows the PRs & Issues view already renders (#981 step 4).
//
// Pure on purpose, and the only part of GitLab support with real tests: the CLI call around it is
// three lines, while THIS is where a wrong field name silently produces an empty or misleading row.
// The fixtures its spec uses were captured from gitlab.com, not written by hand.
import type { CiState, IssueItem, PrItem } from "../../common/ghItems.js";
import { isRecord } from "../../common/isRecord.js";

// GitLab numbers a project's items with `iid` — `id` is globally unique across the instance and is
// NOT what the UI or the URL shows. Using `id` would produce rows whose numbers match nothing.
const itemNumber = (o: Record<string, unknown>): number | null => (typeof o.iid === "number" && Number.isSafeInteger(o.iid) ? o.iid : null);

const authorName = (o: Record<string, unknown>): string => (isRecord(o.author) && typeof o.author.username === "string" ? o.author.username : "");

const text = (v: unknown): string => (typeof v === "string" ? v : "");

function base(raw: unknown): IssueItem | null {
  if (!isRecord(raw)) return null;
  const number = itemNumber(raw);
  // `web_url` is taken as given rather than built: GitLab is moving issues to `/-/work_items/<iid>`
  // and already answers with that path, so composing a URL here would link to the older one.
  const url = text(raw.web_url);
  return number === null || !url ? null : { number, title: text(raw.title), author: authorName(raw), updatedAt: text(raw.updated_at), url };
}

export const normalizeGlabIssue = (raw: unknown): IssueItem | null => base(raw);

// What GitHub splits across `reviewDecision` and `statusCheckRollup`, GitLab collapses into one
// `detailed_merge_status`. Only the values that genuinely mean the same thing are mapped; the rest
// leave the field empty rather than inventing a GitHub verdict for a GitLab state.
//
// Observed across 278 open merge requests on three public projects: not_approved, draft_status,
// unchecked, requested_changes, discussions_not_resolved, mergeable, conflict, ci_must_pass,
// merge_request_blocked.
const REVIEW_BY_MERGE_STATUS: Readonly<Record<string, string>> = {
  requested_changes: "CHANGES_REQUESTED",
  not_approved: "REVIEW_REQUIRED",
};

// The list endpoint carries no pipeline — that needs one call per merge request, which a
// cross-repo list cannot afford. `ci_must_pass` is the one status that says CI is what is holding
// the merge, and even then it does not say whether it failed or is still running, so it reports
// `pending`.
//
// Everything else reports `none`, the same value a GitHub row with no checks carries. That is the
// deliberate limit of this row: `CiState` is GitHub's vocabulary and stays exactly as it is, so a
// GitLab row says no more than a GitHub one can. A merge request whose pipeline is not the blocker
// therefore shows the dim "no checks" dot even when the project does run CI — the honest reading
// is available one click away on the merge request itself.
const ciFromMergeStatus = (status: string): CiState => (status === "ci_must_pass" ? "pending" : "none");

export function normalizeGlabMr(raw: unknown): PrItem | null {
  const item = base(raw);
  if (!item || !isRecord(raw)) return null;
  const mergeStatus = text(raw.detailed_merge_status);
  return {
    ...item,
    // `draft` is its own boolean, so the title prefix does not have to be parsed. `draft_status`
    // says the same thing and is not consulted — one source, not two that can disagree.
    isDraft: raw.draft === true,
    review: REVIEW_BY_MERGE_STATUS[mergeStatus] ?? null,
    ci: ciFromMergeStatus(mergeStatus),
  };
}

/** One issue's detail, from `glab issue view`. GitLab calls the body `description` and numbers the
 *  issue `iid`; `id` is unique across the whole instance and matches nothing a user can look up. */
export function normalizeGlabIssueDetail(raw: unknown): { number: number; title: string; body: string } | null {
  if (!isRecord(raw)) return null;
  const number = itemNumber(raw);
  // An issue with no description is normal — the title is then the whole brief, same as GitHub.
  return number === null ? null : { number, title: text(raw.title), body: text(raw.description) };
}
