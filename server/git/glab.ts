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
// State: neither list is given a state flag. `mr list` has none to give (its help documents the
// open default), and `issue list`'s `--opened` is DEPRECATED — running it prints "Flag --opened has
// been deprecated, default if --closed is not used", which both states the default and warns that
// the flag is going away. Learned by running it, not from the help.
export const glabMrListArgs = (project: string, limit: number): string[] => ["mr", "list", "--repo", project, "--per-page", String(limit), "-F", "json"];

export const glabIssueListArgs = (project: string, limit: number): string[] => ["issue", "list", "--repo", project, "--per-page", String(limit), "-O", "json"];
