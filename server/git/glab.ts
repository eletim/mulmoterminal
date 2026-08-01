// Shared `glab` CLI runner, the GitLab sibling of gh.ts (#981). Same shape on purpose: the CLI's
// own login is the auth, args are argv only (no shell), and a failing repo yields a per-repo error
// rather than sinking the view.
//
// CLI delegation rather than the REST API, matching `gh`: it keeps this app from holding a token
// of its own — the one place that reads a token, the sandbox, already asks the CLI for it.
import { spawnCollect } from "./spawn-collect.js";
import type { GhResult } from "./gh.js";

export function runGlab(args: string[]): Promise<GhResult> {
  return spawnCollect("glab", args, { errorStderr: "glab not found (install the GitLab CLI and run `glab auth login`)" });
}

// `-F json` on `mr list` is the OUTPUT FORMAT; on `issue list` that same short flag means something
// else entirely (`--output-format` = details|ids|urls) and the format flag is `-O`. Verified
// against glab 1.111.0 — writing these from memory produces a command that runs and returns the
// wrong thing.
// State: `glab issue list` takes `--opened`, so it is passed rather than assumed. `glab mr list`
// has no such flag — its help states "Defaults to open merge requests", and the only state flags
// are `--all` / `--closed` / `--merged`. Documented default, not a guess; checked with `--help`
// because a list that quietly included merged requests would look like the view was broken.
export const glabMrListArgs = (project: string, limit: number): string[] => ["mr", "list", "--repo", project, "--per-page", String(limit), "-F", "json"];

export const glabIssueListArgs = (project: string, limit: number): string[] => [
  "issue",
  "list",
  "--repo",
  project,
  "--opened",
  "--per-page",
  String(limit),
  "-O",
  "json",
];
