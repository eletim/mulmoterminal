// Leaving MulmoTerminal's work comments on an issue (#979 Phase 2).
//
// The caller asks for a STATE ("this comment should exist"), not an action, because the client
// that asks is a poll: it re-asks on every tick, from every open tab, and again after a reload.
// So the only correctness property that matters here is that asking twice writes once.
//
// Two layers give that. A process memo answers the repeat asks for free, and the issue's own
// comments are the source of truth for a fresh process — the marker is in the thread, so a
// restarted server, a second instance, or a second browser cannot double-post.
import { runGh } from "./gh.js";
import { isRecord } from "../../common/isRecord.js";
import { alreadyCommented, workCommentBody, type WorkCommentKind } from "../../common/workComment.js";

export interface WorkCommentDeps {
  runGh?: typeof runGh;
}

export interface WorkCommentResult {
  posted: boolean;
  // Why nothing was written, for the caller's log and the route's response. Never an error the
  // UI must handle: not commenting is a normal outcome.
  reason?: "already" | "gh-failed";
  closed?: boolean;
}

// (repo, issue, kind, dir) that this process has already written or found. Never expires: the
// answer cannot become false — a comment is not unwritten — and the set is bounded by the number
// of issues a session works on.
const posted = new Set<string>();

// The memo above only closes the door AFTER a write lands. Two polls arriving together — which is
// the normal case with several tabs open — both find it open, both read the issue, and both post
// (found by Codex review). Callers for the same key therefore share one in-flight run.
const inflight = new Map<string, Promise<WorkCommentResult>>();

const memoKey = (repo: string, issue: number, kind: WorkCommentKind, dir: string) => `${repo}#${issue}:${kind}:${dir}`;

// Test-only: the memo outlives a single case otherwise, and "already posted" would leak across.
export function clearWorkCommentMemo(): void {
  posted.clear();
  inflight.clear();
}

interface IssueView {
  bodies: string[];
  open: boolean;
}

// The issue's comment bodies and whether it is still open, or null when gh could not answer.
async function viewIssue(run: typeof runGh, repo: string, issue: number): Promise<IssueView | null> {
  try {
    const res = await run(["issue", "view", String(issue), "--repo", repo, "--json", "comments,state"]);
    if (!res.ok) return null;
    const parsed: unknown = JSON.parse(res.stdout);
    if (!isRecord(parsed)) return null;
    const comments = Array.isArray(parsed.comments) ? parsed.comments : [];
    const bodies = comments.filter(isRecord).map((c) => (typeof c.body === "string" ? c.body : ""));
    return { bodies, open: parsed.state === "OPEN" };
  } catch {
    return null;
  }
}

/**
 * Make sure `kind`'s comment exists on `issue`, once. `closeIssue` additionally closes a still-open
 * issue — used for the merged comment, where GitHub has usually already closed it via the PR's
 * `Fixes #N`, so this only covers the PRs that didn't say it.
 */
export async function ensureWorkComment(
  repo: string,
  issue: number,
  kind: WorkCommentKind,
  dir: string,
  pr: number | null,
  options: { closeIssue?: boolean } & WorkCommentDeps = {},
): Promise<WorkCommentResult> {
  const key = memoKey(repo, issue, kind, dir);
  if (posted.has(key)) return { posted: false, reason: "already" };

  const running = inflight.get(key);
  if (running) {
    const result = await running;
    // The one that did the work reports the write; this one wrote nothing. A FAILURE is passed
    // through as-is, so a caller does not read "already" from a run that never posted.
    return result.posted ? { posted: false, reason: "already" } : result;
  }
  const run = writeWorkComment(repo, issue, kind, dir, pr, options);
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

async function writeWorkComment(
  repo: string,
  issue: number,
  kind: WorkCommentKind,
  dir: string,
  pr: number | null,
  options: { closeIssue?: boolean } & WorkCommentDeps,
): Promise<WorkCommentResult> {
  const run = options.runGh ?? runGh;
  const key = memoKey(repo, issue, kind, dir);

  const view = await viewIssue(run, repo, issue);
  if (!view) return { posted: false, reason: "gh-failed" };
  if (alreadyCommented(view.bodies, kind, dir)) {
    posted.add(key); // found in the thread — stop asking gh about it
    return { posted: false, reason: "already" };
  }

  const body = workCommentBody(kind, dir, pr);
  const wrote = await run(["issue", "comment", String(issue), "--repo", repo, "--body", body]).catch(() => null);
  if (!wrote?.ok) return { posted: false, reason: "gh-failed" };
  posted.add(key);

  // Closing is best-effort and reported separately: the comment landing is the part that matters,
  // and a repo where the user cannot close issues must not turn into a failed request.
  if (options.closeIssue && view.open) {
    const closed = await run(["issue", "close", String(issue), "--repo", repo]).catch(() => null);
    return { posted: true, closed: closed?.ok === true };
  }
  return { posted: true, closed: false };
}
