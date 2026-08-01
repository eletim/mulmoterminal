import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import { resolveDirRequest } from "../files/dirRequest.js";
import { forgeOf, GITHUB_HOST, type RemoteForge } from "./forge-host.js";

export { GITHUB_HOST };

// The GitHub view of a remote: its repository web URL, or null when the remote isn't on
// github.com. Which host a remote points at — and that a GitHub project is exactly `owner/repo`
// while a GitLab one nests — now lives in forge-host.ts (#981 step 1); this stays as the
// GitHub-shaped answer its six callers already read, so none of them change.
export function parseGithubWebUrl(remoteUrl: string): string | null {
  const forge = forgeOf(remoteUrl);
  return forge?.kind === "github" ? forge.webUrl : null;
}

// Read the dir's `origin` remote. Null when the dir isn't a git repo, has no origin, or git is
// missing — the three ways there is no remote to speak of, which are not the same as a remote we
// do not support.
function readOriginUrl(dir: string): Promise<string | null> {
  return new Promise((resolve) => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' is a standard tool resolved from PATH in this local dev server; dir is passed via -C as a separate argv (no shell)
    const child = spawn("git", ["-C", dir, "config", "--get", "remote.origin.url"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString()));
    child.on("error", () => resolve(null)); // git not installed
    child.on("close", () => resolve(out.trim() || null));
  });
}

/** Which forge this dir's `origin` points at, or null when it has no readable remote. */
export async function resolveRemoteForge(dir: string): Promise<RemoteForge | null> {
  const url = await readOriginUrl(dir);
  return url ? forgeOf(url) : null;
}

// Kept for the callers that only ever wanted the GitHub URL.
export async function resolveGithubUrl(dir: string): Promise<string | null> {
  const forge = await resolveRemoteForge(dir);
  return forge?.kind === "github" ? forge.webUrl : null;
}

interface GitRemoteOptions {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
}

// POST /api/git-remote { path } -> { githubUrl: string | null, forge: RemoteForge | null }.
// Lets the browser (which can't read the filesystem) learn whether a cell's working dir is a
// GitHub repo, and where its repository page is. Same-origin guarded like the other local-only
// routes.
//
// `forge` is the same lookup without the GitHub assumption, so a caller can tell a repo on a forge
// we do not support from a directory with no remote at all — `githubUrl` is null for both. Nothing
// reads it yet (#981 step 1 is the model; what to show is a separate decision).
export function mountGitRemoteRoute(app: Express, { isAllowedOrigin }: GitRemoteOptions) {
  app.post("/api/git-remote", async (req: Request, res) => {
    const dir = resolveDirRequest(req, res, isAllowedOrigin);
    if (!dir) return;
    const forge = await resolveRemoteForge(dir);
    res.json({ githubUrl: forge?.kind === "github" ? forge.webUrl : null, forge });
  });
}
