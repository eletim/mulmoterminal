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

// `issue view` takes `-F` for the output format — like `mr list`, and UNLIKE `issue list`, which
// takes `-O` and gives `-F` a different meaning entirely. Three subcommands, three answers;
// verified against glab 1.111.0 rather than pattern-matched from its sibling.
export const glabIssueViewArgs = (project: string, issue: number): string[] => ["issue", "view", String(issue), "--repo", project, "-F", "json"];

// `note`, not `comment` — and the message flag is `-m`. Checked against glab 1.111.0.
export const glabIssueNoteArgs = (project: string, issue: number, body: string): string[] => ["issue", "note", String(issue), "--repo", project, "-m", body];

export const glabIssueCloseArgs = (project: string, issue: number): string[] => ["issue", "close", String(issue), "--repo", project];

// Existing comments do NOT come back from `issue view -F json`, and `--comments` only affects the
// human-readable output. The REST notes endpoint is where they are, so this is one extra call that
// the GitHub path does not make.
//
// `--paginate` is not optional here. A page holds 20 notes and they arrive NEWEST FIRST, so a
// single page drops the OLDEST — and a work comment is written when work starts, which is exactly
// the end that falls off. Missing it means writing the comment again on an issue that has one
// (Codex review). Measured on a real 23-note issue: one page returned 20, `--paginate` returned all
// 23 as a single JSON array, not concatenated pages.
export const glabIssueNotesArgs = (project: string, issue: number): string[] => [
  "api",
  `projects/${encodeURIComponent(project)}/issues/${issue}/notes`,
  "--paginate",
];
