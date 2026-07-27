// This project's own GitHub repository, and the wire shape of the star endpoints that act on
// it. Both sides decide from these — the server builds the `gh api` path, the client builds
// the link it opens when `gh` cannot answer — so they live here rather than as two copies.
import { isRecord } from "./isRecord.js";

export const GITHUB_REPO = "receptron/mulmoterminal";
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;

// GitHub's "star a repository" endpoint for this repo: GET reports the current state, PUT stars it.
export const STAR_API_PATH = `/user/starred/${GITHUB_REPO}`;

// GET/POST /api/github/star. `null` means the server could not tell — no `gh`, not logged in,
// offline. That is a DIFFERENT answer from "not starred": the client offers a plain link for it
// rather than a button that would silently do nothing.
export interface GithubStarState {
  starred: boolean | null;
}

// Read a star state off an untrusted response body. Anything unparseable reads as "cannot tell",
// which is the same degradation as a failed request, so the caller needs no separate error path.
export function parseStarState(value: unknown): boolean | null {
  return isRecord(value) && typeof value.starred === "boolean" ? value.starred : null;
}
