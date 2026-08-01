# One session per worktree, and an honest "already open"

Fixes #1207.

## Why

A user working in a worktree opened a second terminal for it and landed on the session that was
already running. Their question was the right one: is a terminal tied to the folder, or to the
session?

It is tied to the **session id**. tmux holds `mt-<id>` on our own tmux server, claude runs under
`--session-id <id>` / `--resume <id>`, and cwd is only a launch parameter recorded as `id -> cwd`
(`server/session/dev-terminal-cwds.ts`). Nothing looks a session up by directory, so a fresh launch
(`launchIn` sends no id) always mints a new one and can never collide.

Three paths ask for an id that already exists, and all three miss the same fact:

| | how a live session gets taken over | guard today |
| --- | --- | --- |
| A | the launcher's `or resume here` row, which lists the running grid session too | `● open` + a confirm, but ONLY when that id is a cell in this browser's grid |
| B | a second browser tab on the same origin restores the same localStorage grid and every cell reattaches | none |
| C | a second `mulmoterminal` process: `hasLivePty` is false there, so `tmux new-session -A` attaches a SECOND client and `window-size latest` makes the two sizes fight | a CLI warning at startup; nothing in the UI |

One cause underneath: **"is this session open somewhere?" is answered from the current browser's
grid**, while the server is the only thing that can answer it — it holds the pty table for this
process and can ask tmux about every other one.

## What

### 1. The server answers "attached"

`common/sessionOccupancy.ts` — the wire field plus the rule, shared because both sides read it:

```ts
export function isSessionAttached(facts: OccupancyFacts): boolean;
```

from `viewedHere` (a pty in this process whose socket is still open), `tmuxClients`, and
`holdsTmuxClient` (our own pty IS one of those clients, so it must be subtracted).

An unreadable tmux answer counts as **not** attached. Locking someone out of their own worktree
because a probe failed is worse than the collision it would prevent, and without tmux there is no
cross-process session to collide with in the first place.

`tmuxAttachedCounts()` in `server/infra/tmux.ts` gets every session's client count from ONE
`list-clients` call, so a list of rows costs one spawn rather than one per row.

### 2. One session per worktree

`/api/worktrees` rows gain `session: { id, attached } | null` — the newest resumable session for
that worktree path, and whether anyone holds it. The row then means one of three things:

- **no session** — start a fresh one (unchanged)
- **a session nobody is holding** — the row resumes it, rather than starting a second one
- **a session someone is holding** — the row is disabled and says so

A worktree is tied to a branch, so a second agent in it is not isolation, it is two agents editing
one working tree. The section says that in one line, which is also why there is no "resume which
one?" picker to get lost in.

The refusal belongs to the DIRECTORY, not to the row. A worktree is reachable without touching its
row — pasted into the working-directory field, or picked from a recent-dir chip, which worktrees
become as soon as one is launched in — so the field's play button, its Enter key and the chip's
launch button consult the same answer. (`＋ New worktree` needs no guard: a repeated task name gets
a fresh unique branch, never an existing worktree.)

**The client's answer is the explanation; the server's is the guarantee.** Codex, reviewing the
first version, found the launcher comparing `w.path === dir` — so `/wt/x/` or `/repo/../wt/x` typed
into the field walked straight past a row marked `in use`. Normalizing the comparison fixes those
spellings and nothing else: a symlinked path, a chip into a repo whose worktree list was never
fetched, the phone, and the remote-host bridge all still reach a spawn. So the rule is enforced
where the session is actually created (`session/worktree-session-limit.ts`, wired into the three
agent WebSocket handlers), using the realpath containment check `isManagedWorktree` already does.
The client keeps a lexical `dirPathKey` comparison so the control greys out *before* the click.

A plain shell is exempt on both sides: the limit is on agents sharing one working tree, and
`dir-session.ts` leaves shells out of the answer for the same reason.

### 3. The resume list stops offering what it cannot give

`/api/sessions` rows gain the same `attached` field, and an attached row is disabled with the
reason on it. This is what closes B and C: the badge no longer depends on the browser having the
other viewer in its own grid.

## Not done here

- No cross-process lock or handover. "Open elsewhere" is reported and refused, not stolen.
- The pre-existing confirm for taking over a session in the same grid goes away with it — a
  disabled row with a reason replaces a dialog that could be clicked through.
