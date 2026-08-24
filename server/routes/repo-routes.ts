// Header-level GitHub routes. Cross-repo PR/issue list routes are intentionally not
// mounted; session-specific PR links are resolved through the directory header route.
import type { Express } from "express";
import { readStarState, starRepo } from "../git/github-star.js";
import type { GithubStarState } from "../../common/githubRepo.js";

export function mountGithubStarRoutes(app: Express): void {
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
