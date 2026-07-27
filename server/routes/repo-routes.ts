// The /prs and /issues views: open pull requests and issues across the repos the user
// configured, via the server's own `gh` login. Repos come from config, never the request.
import type { Express } from "express";
import { getPrRepos } from "../config/config-routes.js";
import { listPrsAcrossRepos } from "../git/prs.js";
import { listIssuesAcrossRepos } from "../git/issues.js";
import { readStarState, starRepo } from "../git/github-star.js";
import type { GithubStarState } from "../../common/githubRepo.js";

export function mountRepoRoutes(app: Express): void {
  // Cross-repo PR list (the /prs view): aggregate open PRs for the configured repos via
  // the server's `gh` login. Repos come from config (never the request).
  app.get("/api/prs", async (_req, res) => {
    try {
      res.json({ repos: await listPrsAcrossRepos(getPrRepos()) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Sibling of /api/prs: the same configured repos' open issues (capped per repo).
  app.get("/api/issues", async (_req, res) => {
    try {
      res.json({ repos: await listIssuesAcrossRepos(getPrRepos()) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // The header's "star this project on GitHub" button. Not a configured repo like the two
  // above — it is always this project, so the target is a constant and never the request.
  // `starred: null` is "cannot tell" (no `gh`, not logged in, offline), which hides the button.
  app.get("/api/github/star", async (_req, res) => {
    try {
      const body: GithubStarState = { starred: await readStarState() };
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Stars the repo through the user's `gh` login. A write, so the app-wide same-origin gate
  // (app-routes.ts) covers it: a page the user happens to visit must not star on their behalf.
  app.post("/api/github/star", async (_req, res) => {
    try {
      const body: GithubStarState = { starred: await starRepo() };
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
