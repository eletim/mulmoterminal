# fix #794 — Windows: `claude` fails to spawn when only `claude.exe` exists

## Symptom

On Windows every `claude` session fails to start:

```
[ws] failed to start session <id>: File not found:
```

— the path after `File not found:` is EMPTY. Codex sessions on the same host spawn fine.

## Root cause (confirmed against node-pty 1.1.0 sources)

`pty.spawn("claude", …)` reaches node-pty's Windows entry point, which gates the spawn on
its own PATH lookup (`src/win/conpty.cc:275-288`, same shape in the legacy `winpty.cc`):

```cpp
if (::PathIsRelativeW(filename.c_str())) shellpath = path_util::get_shell_path(filename.c_str());
else                                     shellpath = filename;
if (shellpath.empty() || !path_util::file_exists(shellpath)) throw "File not found: " + shellpath;
```

`get_shell_path` (`src/win/path_util.cc`) walks the PATH directories and compares the file
name **exactly** — it never appends an executable extension. A bare `"claude"` therefore
misses `…\.local\bin\claude.exe`, `shellpath` stays empty, and the message prints nothing
after the colon.

Three findings beyond the issue report, all read from the vendored sources:

1. **The gate and the actual launch resolve differently.** `PtyConnect` calls
   `CreateProcessW(nullptr, cmdline, …)` (`conpty.cc:413`), so Windows itself searches PATH
   and appends `.exe` when the name has no extension. `get_shell_path` is *only* a
   pre-flight check. That is why `codex` works on the reporter's host by accident: the
   extensionless shim `…\.local\bin\codex` satisfies the gate, while the process that
   actually runs is a `codex.exe` from a different PATH directory.
2. **`CreateProcessW` cannot execute `.cmd` / `.bat` / extensionless shims.** Resolving a
   bare name to such a file would turn a working spawn into `Cannot create process` — the
   codex case above is exactly that regression. So the resolver must only ever hand back a
   PE image (`.exe` / `.com`). npm-global installs (`claude.cmd` + an extensionless shim)
   need a `cmd.exe` wrapper and are deliberately out of scope here (follow-up issue).
3. **Two more node-pty bugs in the same function**, neither on the critical path but worth
   pinning in tests: the PATH splitter never pushes the segment after the last `;`, so the
   final PATH directory is never searched; and an early `if (file_exists(filename)) return
   shellpath;` returns the *empty* string for a name that exists relative to the cwd.

node-pty's latest stable is still 1.1.0 (1.2.0 is beta-only), so waiting for upstream is
not an option — this is fixed on our side.

## Scope: every bare name we hand to node-pty

All five spawn sites funnel through one function, `spawnPty()` (`server/session/pty-spawn.ts`):

| call site | name passed |
| --- | --- |
| `session/spawn-claude.ts` | `deps.claudeBin` — `CLAUDE_BIN` or `"claude"` (`agents/claude.ts`) |
| `session/spawn-codex.ts` | `deps.codexBin` — `CODEX_BIN` or `"codex"` (`agents/codex.ts`) |
| `session/pty-spawn.ts` (tmux) | `"tmux"` — hard-coded, no env override |
| `session/pty-spawn.ts` (sandbox) | `"docker"` — darwin-gated, unaffected in practice |
| `session/spawn-shell.ts` | `"powershell.exe"` on win32 (already has an extension) |

Fixing `spawnPty()` covers all of them, including the tmux path reported in the issue
follow-up, which has no `*_BIN` escape hatch of its own.

## The fix

New `server/infra/resolve-bin.ts`:

- `resolveWindowsExecutable(bin, searchPath, isExecutableFile)` — pure. Returns the absolute
  path of the first `<PATH dir>\<bin>.exe` / `.com` (or `<PATH dir>\<bin>` when `bin`
  already ends in `.exe`/`.com`), or `null`. Uses `path.win32` and `";"` explicitly so the
  rule is checkable from any host. `null` for a name that already contains a separator.
- `resolvePtyBin(bin, platform, searchPath)` — `bin` unchanged on non-Windows and whenever
  nothing resolves, so a host that works today keeps working.

`spawnPty()` calls `resolvePtyBin` with the PATH of the **sanitized child env** (via a new
`pathFromEnv` in `infra/pty-env.ts`, which knows Windows spells it `Path`) rather than
`process.env` — the binary a session needs is the one findable from the environment that
session will run in.

Deliberately NOT done here:

- No `.cmd`/`.bat` support (needs a `cmd.exe /c` wrapper plus its own escaping story —
  filed separately).
- No memoization: PATH lookups are ~2 `existsSync` calls per PATH entry per spawn, and a
  cache would go stale the moment a user installs the CLI mid-session.
- `tmuxAvailable()` still detects via `spawnSync` (libuv, which does honour PATHEXT), so a
  `tmux.cmd`-only host would still detect tmux and then fail to spawn it. psmux ships
  `tmux.exe`; revisit with the `.cmd` follow-up.

## Tests

`test/server/infra/resolve-bin.spec.ts` — pure, runs on every OS in the PR CI matrix:
happy path, PATH order, the **last** PATH entry (the node-pty splitter drops it),
extensionless / `.cmd` / `.bat` candidates ignored, a name that already carries `.exe`,
names containing a separator, empty and missing PATH, empty PATH entries, case-insensitive
extension match, and `resolvePtyBin`'s two pass-through arms.

`test/server/session/pty-spawn-win.spec.ts` — `skipIf(process.platform !== "win32")`, so it
only runs in `.github/workflows/windows-daily.yaml` (which already runs `yarn test`):
copy `process.execPath` into a temp dir as `mt-probe-<pid>.exe`, prepend the dir to PATH,
then assert (a) the resolver returns that absolute path, (b) `spawnPty` with the bare name
actually spawns and exits 0, and (c) a raw `pty.spawn` with the same bare name still throws
`File not found:` — the regression pin that tells us when node-pty fixes this upstream and
the workaround can be dropped.

Run the Windows job on the PR branch with
`gh workflow run windows-daily.yaml --ref fix/794-windows-pathext`.
