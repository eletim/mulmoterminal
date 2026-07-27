# Tell the session which clone its PRs came from

Issue: #973

## Why

#872 added `work in <clone>` to PR bodies so that, with several checkouts of one repo side by
side, a PR says which produced it. It was wired into `createOrOpenPR` — the ⧉ Open PR button.

Nearly every PR in this repository is opened by an agent running `gh pr create`, which never
touches that path. Checked ten recent PRs (#945, #951, #952, #961, #969, #963, #964, #967, #970,
#971): **none of them carried the line**. The feature worked exactly as built and was invisible in
practice.

## What

The instruction rides on the session's system prompt, next to the closing-summary one that is
already appended at spawn (`--append-system-prompt`).

**The clone name is resolved by the server and pasted into the text**, rather than asking the
agent to work it out. That is the whole point: inside a managed worktree an agent would report the
worktree's name, and the worktree name carries nothing a reader wants — its branch is already on
the PR. `repoRoot()` answers with the main checkout, which is what identifies the clone.

Same switch as the button (`prWorkdirFooter`), read per spawn as the button reads it per PR, so
turning it off still needs no restart.

## The synchronous resolver

The spawn path returns a `PtyEntry` and is synchronous by contract, with a dozen callers; the
existing `repoRoot()` is async. Rather than make all of them async, `repo-root-sync.ts` walks up to
the `.git` entry and reads a linked worktree's `gitdir:` pointer — no subprocess, and the same
shape as the config reads that path already does (`loadDirConfig`).

Its spec builds a **real repo with a real linked worktree** and asserts the sync resolver agrees
with the async one, so the hand-rolled pointer parsing is checked against git rather than against
an assumption about what git writes.

## Incidental

`createClaudeSpawner` was at exactly the 60-line lint ceiling, so one more field could not be
added. The backend/model decision — one decision made from three sources, not part of spawning —
moved out to `resolveSessionBackend`.

## Not done

The ten PRs listed above were already merged. The five opened from this clone were edited to carry
the line; the others were opened from clones this session cannot identify, and guessing would put
a wrong name on a merged PR.

## Review follow-up

**Codex: the clone name reaches the system prompt unsanitised.** Correct. A clone name is a
DIRECTORY name, and on POSIX that can hold newlines and control characters — a name containing a
line break would read as instructions of its own inside the appended prompt. The practical risk is
low (these are directories the user made on their own machine), but the value crosses a trust
boundary and the defence is cheap.

Sanitised in `workdirFooter`, where the untrusted value enters, rather than at each use: control
and format characters collapse to spaces, runs of whitespace collapse, the name is capped at 64
characters, and a name with nothing printable left yields **null** — no line at all, rather than a
dangling `work in `. Doing it there also covers the PR-body path, which had the same input.

`workdirFooter` therefore returns `string | null` now, and the button path skips the append when it
is null.
