# feat #795 — load `.env` from the launch directory when started via npx

## The gap

The "Running a session on another model" modal tells the user their key belongs "in the
shell that starts MulmoTerminal, or a `.env` beside it". That is true for a dev launch and
false for every real one:

| launch | server spawn | `.env` |
| --- | --- | --- |
| `yarn dev` / `yarn server` | `node --import tsx --env-file-if-exists=.env server/index.ts` | read |
| `npx mulmoterminal` | `spawn(node, ["--import","tsx", SERVER_ENTRY], { cwd: PKG_DIR, env: {...process.env} })` | **never read** |

So a key written into `.env` never reaches the server, the provider stays `ready:false`, and
the launch form shows no MODEL selector. The only workaround is exporting in the shell first.

## Measured behaviour (Node v24.12, this host)

Both settled by experiment rather than by reading docs, because both decide what a user's
key does:

- **The shell wins.** A variable set in the environment is NOT overwritten by the same name
  in `.env` — so adding this cannot silently replace a key someone exported.
- **With several `--env-file` flags, the last one wins**, and every file's unique keys load.

Pinned as a test (`test/bin/env-file-precedence.spec.ts`) rather than trusted: the whole
point of the feature is which value a key ends up with, and CI runs Node 22 and 24.

## Decision: the launch directory, not the workspace

`.env` is read from `process.cwd()` — where the user typed the command — and nowhere else.

The two coincide for a bare `npx mulmoterminal`: `chooseCwd` (bin/cli-args.js) returns `"."`
with no `--cwd`, so the workspace already IS the launch directory. (`~/mulmoclaude` is
`server/config/env.ts`'s fallback for a server started WITHOUT the launcher; the launcher
always passes a resolved `CLAUDE_CWD`.) They differ only when `--cwd <dir>` is given, and
there the shell's directory is what the modal's wording promises, and what the user can see.

Not done: a `.env` in the workspace, a global one, or several files at once.

## Change

- `bin/cli-args.js` gains `serverNodeArgs(serverEntry, launchDir)` — the launcher's decisions
  live there precisely so they can be checked without spawning anything.
- `bin/mulmoterminal.js` uses it for the server spawn. The spawn `cwd` stays `PKG_DIR`, so
  the flag carries an absolute path; a relative `.env` would resolve against the package
  directory and find nothing.
- Docs say the launch directory, in all three places that describe this: the modal
  (`src/components/ModelSetupHelp.vue`), the config skill
  (`server/skills/mulmoterminal-config/SKILL.md`), and the README.

`.env` values reach the PTY sessions too, since a session inherits the server's environment.
That is already true of a dev launch and is what the modal describes, so it stays — stated in
the docs rather than left to be discovered.

## Tests

- `test/bin/cli-args.spec.ts` — the flag is present, carries the absolute `.env` path, sits
  before the entry script (a Node option after the script path is an argument to the script),
  and a launch directory containing spaces stays one argv element (no shell is involved).
- `test/bin/env-file-precedence.spec.ts` — spawns the real `node` to pin both measured rules
  above, so a Node upgrade that flips either one fails here instead of in someone's session.
