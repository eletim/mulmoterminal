import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import { resolveDirRequest } from "../files/dirRequest.js";
import { parseRemoteRef, topSegments } from "./remote-ref.js";

// Convert a git remote URL to its GitHub repository web URL, or null when the remote isn't on
// github.com. Pure (no I/O) so it's exhaustively unit-tested.
//
// The URL FORMS a remote can take live in remote-ref.ts — they belong to git, not to GitHub
// (#981). What is GitHub's own is the two rules here: the host, and that a project is exactly
// two path segments (owner/repo), so a deeper path is truncated rather than rejected.
export const GITHUB_HOST = "github.com";
const GITHUB_PATH_SEGMENTS = 2;

export function parseGithubWebUrl(remoteUrl: string): string | null {
  const ref = parseRemoteRef(remoteUrl);
  if (!ref || ref.host !== GITHUB_HOST) return null;
  const repo = topSegments(ref.path, GITHUB_PATH_SEGMENTS);
  return repo ? `https://${GITHUB_HOST}/${repo}` : null;
}

// Read the dir's `origin` remote and map it to a GitHub web URL (null if the dir
// isn't a git repo, has no origin, git is missing, or origin isn't GitHub).
export function resolveGithubUrl(dir: string): Promise<string | null> {
  return new Promise((resolve) => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' is a standard tool resolved from PATH in this local dev server; dir is passed via -C as a separate argv (no shell)
    const child = spawn("git", ["-C", dir, "config", "--get", "remote.origin.url"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString()));
    child.on("error", () => resolve(null)); // git not installed
    child.on("close", () => resolve(parseGithubWebUrl(out)));
  });
}

interface GitRemoteOptions {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
}

// POST /api/git-remote { path } -> { githubUrl: string | null }. Lets the browser
// (which can't read the filesystem) learn whether a cell's working dir is a
// GitHub repo, and where its repository page is. Same-origin guarded like the
// other local-only routes.
export function mountGitRemoteRoute(app: Express, { isAllowedOrigin }: GitRemoteOptions) {
  app.post("/api/git-remote", async (req: Request, res) => {
    const dir = resolveDirRequest(req, res, isAllowedOrigin);
    if (!dir) return;
    res.json({ githubUrl: await resolveGithubUrl(dir) });
  });
}
