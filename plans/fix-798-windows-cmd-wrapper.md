# fix #798 — Windows: launch a `.cmd`-only CLI through `cmd.exe`

Follow-up to #794 / #799, which resolved a bare command name to an absolute `.exe`/`.com`
before node-pty's own PATH lookup could fail on it. This one covers the case that fix
deliberately left out: an npm-global install, where the only thing on PATH is a batch shim.

```
npm i -g @anthropic-ai/claude-code   →  <npm prefix>\claude       (extensionless sh shim)
                                        <npm prefix>\claude.cmd
                                        <npm prefix>\claude.ps1
                                        (no claude.exe)
```

## Why it fails today

node-pty launches through `CreateProcessW`, which runs PE images only — it cannot execute a
`.cmd`, a `.bat`, or an extensionless shell shim. Both shapes of the failure look identical
to the user (the generic "Failed to start Claude" close frame):

| on PATH | node-pty's gate (`get_shell_path`) | `CreateProcessW` | logged |
| --- | --- | --- | --- |
| `claude.cmd` only | fails (exact-name match) | never reached | `File not found: ` |
| `claude` shim + `claude.cmd` | passes on the shim | looks for `claude.exe`, misses | `Cannot create process` |

## The fix

`cmd.exe /d /s /c "…"` wrapping, decided in the same place as #799 so every spawn site
inherits it:

- **`server/infra/cmd-escape.ts`** (new, pure) — builds the command line for a batch target.
  `/d` skips AutoRun (a registry-injected command would otherwise run first), `/s` makes cmd
  strip exactly the outer quote pair and take the rest verbatim, which is what keeps the
  quoting rules below predictable.
- **`server/infra/resolve-bin.ts`** — resolution now returns a launch descriptor
  (`{ file, args }`) rather than a path, so a batch target can name `cmd.exe` as the file.
- **`server/session/pty-spawn.ts`** — hands the descriptor to `pty.spawn`. node-pty accepts a
  raw command-line **string** in place of an argv array (`argsToCommandLine` passes a string
  through verbatim), which is what lets us own the quoting of everything after `cmd.exe`.

### Resolution order: `.exe`/`.com` everywhere, only then `.cmd`/`.bat`

Not cmd.exe's own per-directory order. A host that works today must keep running the exact
same file: the reporter's codex install has an extensionless shim (and a `.cmd`) in an
*earlier* PATH directory than the `codex.exe` that actually runs, so a per-directory order
would silently move it onto the batch path — more layers, and the escaping caveats below —
where it currently launches directly. The batch path is a fallback for "nothing executable
exists at all", never a preference.

### Argument escaping — the actual work

Wrapping in `cmd.exe` means the command line is parsed twice: by cmd, then by the child's
CRT. cmd treats `& | < > ^ ( )` as metacharacters, and `\"` — the CRT's escape, which
node-pty's own `argsToCommandLine` emits — does **not** escape a quote to cmd; it just ends
the quoted section, which is precisely the injection this has to prevent. So for the cmd
layer each argument is:

- rejected outright when it contains NUL, CR or LF (not representable on a command line),
- always wrapped in `"` (inside quotes, cmd's metacharacters are literal),
- with every internal `"` doubled (`""`, cmd's own escape — not `\"`),
- and a trailing run of backslashes doubled, so it cannot escape the closing quote at the
  CRT layer.

Known limitation, pinned as a test rather than fixed: `%VAR%` is still expanded by cmd inside
double quotes, and `^` cannot prevent it. Rust hit the same wall (CVE-2024-24576) and Node
answered it by refusing to spawn `.cmd` without `shell: true` at all (CVE-2024-27980).
Rejecting every argument containing `%` was considered and dropped — a Claude prompt with a
percent sign in it is ordinary, and env-var substitution into our own child's argument is a
correctness wart, not a privilege boundary.

The escaping is empirical, not theoretical: the Windows CI job round-trips real arguments
through a shim built like npm's (`node "…cli.js" %*`) and asserts the child's `process.argv`
matches what was passed. Anything that does not round-trip gets rejected by the escaper
rather than guessed at.

## Tests

- `test/server/infra/cmd-escape.spec.ts` — pure, every OS: plain, spaces, tabs, embedded
  quotes, JSON (our real `--settings` / `--mcp-config` payloads), `& | < > ^ ( )`, trailing
  backslashes, empty string, CJK, and the NUL/CR/LF rejections.
- `test/server/infra/resolve-bin.spec.ts` — the `.exe`-before-`.cmd` ordering, the descriptor
  shape for each target kind, and the existing #794 cases unchanged.
- `test/server/session/pty-spawn-win.spec.ts` — Windows only: spawn through a generated
  npm-style `.cmd` shim and assert the argument round-trip, plus exit code propagation.

Verify with `gh workflow run windows-daily.yaml --ref fix/798-windows-cmd-wrapper`.
