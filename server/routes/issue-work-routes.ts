// POST /api/issues/start — begin work on a GitHub issue (#1173). Cuts the issue's worktree and
// spawns a session in it with the issue waiting in the input box, so the `/prs` issue list stops
// being somewhere to read and becomes somewhere to start.
//
// A write (it creates a branch, a directory and a process), so it is same-origin guarded like the
// other local-only mutations.
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { getCwdPresets, getRepoDirs } from "../config/config-routes.js";
import { repoDirsFromPresets } from "../git/repo-dirs.js";
import { startIssueWork } from "../git/issue-work.js";
import { isIssueNumber } from "../../common/prPhase.js";
import { canonicalRepo, isRepoEntry } from "../../common/repoEntry.js";
import { requestOriginAllowed } from "./same-origin-guard.js";

export interface IssueWorkRouteDeps {
  /** Narrower than the spawner's own type on purpose: this route ignores the PtyEntry it returns,
   *  and asking for the whole shape would make every caller — including a test — construct one. */
  spawnClaudePty: (sessionId: string, resume: null, ws: null, options: { cwd: string; draft: string; attachGuiMcp: boolean }) => unknown;
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
}

// A failure the caller can act on (pick another clone, check the issue number, close the terminal
// holding the worktree) is a 409; a repo or directory that is not theirs to name is a 403.
const STATUS_FOR_REASON: Record<string, number> = { "issue-not-found": 409, "worktree-busy": 409, "worktree-failed": 500 };

export function mountIssueWorkRoutes(app: Express, deps: IssueWorkRouteDeps): void {
  app.post("/api/issues/start", async (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).end();
    const { repo, issue, dir } = req.body ?? {};
    if (typeof repo !== "string" || !isRepoEntry(repo) || !isIssueNumber(issue) || typeof dir !== "string") {
      return res.status(400).json({ error: "repo ([host/]owner/repo), a positive issue number and dir are required" });
    }
    // Everything below names the repository the way its own host does. An entry may spell the host
    // out (`github.com/owner/repo`), and `/api/repo-dirs` keys by the name read off a clone's
    // remote, which never carries one — comparing the two forms found nothing (Codex review).
    const project = canonicalRepo(repo);

    // `dir` arrives from the browser but becomes a spawn's working directory, so it is not taken
    // on trust: it has to be one of the clones the server itself resolved for THIS repo. Without
    // the check, a request could start an agent in any directory on the machine — and in one that
    // has nothing to do with the issue being claimed.
    const known = await repoDirsFromPresets(getCwdPresets(), getRepoDirs());
    const entry = known.find((r) => canonicalRepo(r.repo).toLowerCase() === project.toLowerCase());
    if (!entry?.dirs.some((d) => d.path === dir)) {
      return res.status(403).json({ error: `${dir} is not a known clone of ${repo}` });
    }

    const result = await startIssueWork(project, issue, dir, {
      spawnDraft: (cwd, draft) => {
        const sessionId = randomUUID();
        // attachGuiMcp:false — this is a working session in a repository, the same shape as a grid
        // dev terminal, so the project's own MCP servers load instead of being replaced by the GUI
        // one under --strict-mcp-config.
        deps.spawnClaudePty(sessionId, null, null, { cwd, draft, attachGuiMcp: false });
        return sessionId;
      },
    });

    if (!result.ok) return res.status(STATUS_FOR_REASON[result.reason ?? ""] ?? 500).json(result);
    res.json(result);
  });
}
