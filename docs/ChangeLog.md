# Changelog

Release notes for MulmoTerminal, mirrored from the [GitHub Releases](https://github.com/receptron/mulmoterminal/releases). Newest first. Versions before `0.6.0` are on GitHub Releases only.

This file records **what changed and why**. For **how to actually use** a new feature, a release may also ship a dated setup guide — linked at the top of its entry, and written as a snapshot of that moment. The living reference is always the [guide](https://receptron.github.io/mulmoterminal/).

## mulmoterminal@2.0.0 — 2026-07-26

> 📘 **[How to use what this release added](https://receptron.github.io/mulmoterminal/guide/en/v2.0.0.html)** — step-by-step setup for the keymap, Push kinds and the phone features, written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.0.0.html))

Keyboard shortcuts arrive, Web Push becomes selective, and the phone companion gains three abilities. Nothing here changes an existing install's behaviour: the keymap is empty until you write one, and Push keeps notifying exactly as before unless you narrow it.

### Keyboard shortcuts — a user-defined keymap (#837, #843, #841)

Drive the grid without reaching for the mouse. **There are no defaults**, deliberately: every key you bind is one the program inside the terminal stops receiving, and only you know whether that trade is worth it. Bindings live in `~/.mulmoterminal/config.json` under `keymap`.

- **`zoom-toggle`** — enlarge / collapse, and the ONLY action that changes that. It enlarges whichever terminal the cursor is in, and collapsing leaves the cursor there, so a round trip never loses your place.
- **`next-attention`** — move to the next terminal worth looking at: awaiting input, then finished-and-unreviewed, then idle, skipping anything mid-turn. Cycles rather than stopping at the end. Zoomed it moves the enlargement; un-zoomed it moves the keyboard focus, switching page if the terminal is on another one.
- **`zoom-next` / `zoom-prev`** — walk the enlargement along the on-screen order.
- **`terminal-new`**, **`terminal-new-adjacent`** (beside the current terminal, inheriting its directory — the nearest thing the grid has to a split), **`terminal-close`**.

Modifiers match exactly, so binding a bare key leaves `Shift`+key to xterm's scrollback. A **malformed binding stops the server from starting** and prints the offending line: a silently dropped typo looks identical to a shortcut that simply does not work, which sends people hunting in the app for a one-character problem in a file. An unknown action name only warns, so a config written for a newer version still loads. Two actions on one keystroke warn, naming the one that actually fires. **Settings → Keyboard shortcuts** lists every action and its binding — including the unbound ones, since that is how the actions are discovered at all.

The guide carries five ready-made keymaps (minimal, arrow-keys, tmux-flavoured, iTerm2-flavoured, supervising-many-agents) and the platform traps, documented from Apple and MDN: on macOS the top-row keys are media keys and deliver no keydown at all without `Fn`, `Option`+letter arrives as the composed character rather than the letter, and `Cmd`/`Ctrl`+`W`/`T`/`N` are reserved by the browser and can never be bound.

### Web Push, per kind (#851)

Push fired on both finished turns and permission prompts, with one global on/off as the only control — so asking to be told when a task finishes also meant a notification on every permission request during it. `pushKinds` chooses which moments notify, from Settings. An unset value keeps both, so upgrading loses no notifications; an explicit empty list silences every kind while leaving the toggle on.

### Phone companion (#836, #840, #844, #849)

- **Launch a terminal from the phone**, in the working directory of the session on screen.
- **Quick-reply chips you define yourself**, tapped to drop your own phrases into the input box.
- **A link to GitHub** from the session screen when the directory is a GitHub repository.
- A guide page describing what the phone can ask this host to do.

### Fixes

- **A terminal killed by xterm recovers in place** instead of demanding a page reload (xterm 6.0.0 buffer corruption, #846 / #848).
- **Clicks reach clickable elements inside a TUI again**: the click reports that disappeared when #729 was reverted are synthesised (#847).
- The phone's GitHub link points at the repository root — the `tree` form 404s on some repositories (#839).

### Maintenance

- `@mulmoclaude/core` → `^1.6.0` and `material-symbols` → `^0.45.9`, with the lockfile deduped. A nested copy of core 1.5.0 was genuinely installed alongside 1.6.0, so its module state was not shared and its native bindings initialised twice (#853).
- `isRecord` is one implementation in `common/` instead of 29 local copies, and it rejects arrays (#828 / #852).
- Documentation: how a clicked file path routes by extension (#835), the docs-site link at the top of the README (#838), and the fact that `yarn typecheck` does not compile the specs — only `typecheck:test` does (#842).

## mulmoterminal@1.12.0 — 2026-07-26

No new features — this release is entirely durability and correctness work, plus a dependency refresh. Every item below is a failure a 1.11.1 user can hit today without being told why.

### Your configuration can no longer be destroyed by a crash

- **`saveAppConfig` wrote non-atomically** (#822): `writeFileSync` truncates the destination and then fills it, so a crash, a kill, or a full disk mid-write leaves a half-written `config.json`. The next boot reads that as corrupt, and the lenient loader turns corrupt into an empty config — every provider, launcher, and header button, gone. `server/files/atomic-write.ts` exists for exactly this ("so a crash mid-write can't leave a truncated one behind") and was already used by feeds and scheduled sessions, but not by the file whose loss costs the most. It has a synchronous sibling now, and both `saveAppConfig` and the cwd presets go through it. A failed rename throws, which the callers already report as "the save failed" — with the previous file still on disk, which is the point.

  No retry loop in the sync version on purpose: the async one can wait out a Windows lock, but a synchronous caller cannot stall the event loop. The writer and renamer are injected, because the property that matters — that the destination is never opened for writing — is invisible from outside; the difference only shows if the process dies between the two calls. The first version of these tests passed just as happily against a plain `writeFileSync`, so they now assert on the calls themselves.

- **API tokens outlived their sessions** (#822): `cleanupSessionSettings` only ran from `reap()`, which a crash never reaches. What stayed behind was not inert — a provider session's settings file holds its API token, so the token survived the session, survived being rotated or revoked, and survived the provider being removed from the config. Boot now prunes every settings file not backed by a surviving tmux session; nothing else can still be reading one, since a PTY without tmux died with the server that owned it. Files belonging to live sessions, and files we did not write, are left alone.

### The phone link recovers instead of going quietly dead

- **The Firestore command channel stopped for good after a sleep or a network change** (#823, #825): `@mulmoclaude/core`'s `startHostRunner` gives up on its listener permanently — a non-transient error stops it outright, and a transient one only survives five retries (~31s). Anything longer outlasts it, so the host went offline while the toolbar still showed the last state it happened to fetch. The first sign was the phone failing to connect, with nothing on the Mac but a single server log line.

  - **`resilientRunner`** re-subscribes on core's behalf and gives up on **time** (5 min) rather than a retry count, then passes the closure through so the client can escalate to a full re-auth from its parked blob.
  - **The listener error text core drops on the floor is kept**, logged, and surfaced.
  - **`healthNotice`** raises an urgent bell entry when the channel gives up, cleared when it comes back — asked of the notifier rather than remembered, so a notice raised before a restart is still found.
  - **`/api/remote-host/*` responses now carry `health`** (`online` / `reconnecting` / `offline`, plus the last listener error), and the toolbar shows **Online / Reconnecting… / Offline** with the cause.
  - **A 30s poll** keeps an idle tab from going stale and from never firing its auto-reconnect.

  Escalation is staged: re-subscribe for the first 5 minutes (backoff 1s→60s, which covers sleep and network moves), then give up to disconnected with a bell notice while the client re-authenticates from its parked blob (the only path that fixes an expired token), then discard the blob and prompt for Connect if that 401s. `lastError` is cleared on confirmed recovery, so a later outage cannot report a finished incident's cause. The wrapper coexists harmlessly with a fixed core.

### Windows: four silent failures, none of which said anything

All of these are invisible from POSIX.

- **A config file saved on Windows was read as no config at all** (#821): Notepad, `Set-Content`, and PowerShell 5.1's `Out-File -Encoding utf8` all write a UTF-8 BOM. Node's utf8 decode leaves the leading U+FEFF in place, so `JSON.parse` throws on character one — and this repo's config readers answer an exception with an empty config. `.mulmoterminal.json` lost its colors, badges, buttons, provider and model; `script.json` lost the Run menu; cwd presets vanished; `config.json` was judged corrupt, which the lenient loader turns into no providers, launchers, or header buttons. Nothing was ever displayed. The repo already had two workarounds for the same trap (SKILL.md frontmatter and wiki pages) — the rule was known and simply had not reached the JSON readers, so it now lives in `server/infra/read-text-file.ts`. Only a *leading* BOM is stripped; a U+FEFF in the middle is a zero-width no-break space, i.e. content. Genuinely broken JSON is still judged corrupt, which is what stops the app-config writer from overwriting a file you are editing.
- **Scheduled tasks and the translation cache had the same BOM trap** and now go through the same reader.
- **DOS device names reached the file routes** (#821): Windows resolves `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9` in *every* directory, so `C:\anything\NUL` is the null device, not a missing file — containment answered "inside the base" and the open hit a device. `NUL` read empty; **`CON` blocked until console input arrived, hanging the request**. Extensions do not help (`CON.txt` is still CON), nor do trailing dots or spaces. The guard sits in `resolveContained`, the gate both file entry points already share, so one route cannot be fixed without the other. Windows only — `con` is an ordinary filename on POSIX. Matching is per segment, on both separators, case-insensitive, and lets `console.ts` / `nullable.ts` / `com10.txt` through.
- **Cleanup deletion threw on a locked file** (#821): `rmSync(..., { force: true })` only swallows "it wasn't there"; on Windows a file another process holds open fails with EPERM/EBUSY. Every one of these six call sites is cleanup — the work they belong to has already finished or failed — so an exception only turns a transient lock into broken housekeeping: `reap` stopping partway while an exiting claude still holds a settings file, boot giving up on installing skills. They all go through `server/infra/fs-cleanup.ts` now and report failure as a return value.
- **Two CRLF line-splitting bugs** (#820): "split external text into lines" was written as `split("\n")` in about 20 places; under CRLF each line keeps a trailing `\r`, poisoning whatever that rule feeds. `parseNumstatLine` produced diff paths like `src/a.ts\r`, so the client requested a diff for a path that does not exist and got nothing; `parseTmuxEnvironment` left an invisible character on every env value. Both moved to a new `server/infra/split-lines.ts`. Four more sites were verified safe by their own `trim`/`JSON.parse` and now carry CRLF cases so that safety cannot be removed silently; the rest were deliberately left rather than mass-rewritten.

### Windows: the spawn paths that had never been tested there

- **The Run menu / launcher PowerShell path** (`powershell.exe -NoLogo -Command`) had only pure argv-shape tests and had never actually been spawned on Windows; it now has 9 real-PTY cases covering quoted JSON, metacharacters, exit codes, and cwd (#820).
- **The codex argv path had no coverage at all**, which matters because `buildCodexArgs` deliberately embeds double quotes for TOML (`-c key="value"`) — if they are lost the value stops being a string. It now round-trips through the `.cmd` shim. The comment in `codex-args.ts` claiming "no shell is involved" stopped being true when #801 put codex behind a `.cmd`, and is corrected.
- **Adversarial argument content**: one spawn passing 20 arguments with the whole argv compared, so a dropped, split, joined, or reordered argument is caught. Leading/trailing whitespace and tabs, embedded quotes, `""`, `^ ( ) [ ] { }`, `& | < >`, `; , =`, `!`, `$` and backticks, runs of backslashes including trailing ones, Japanese, emoji (surrogate pairs), accents. The empty-string argument is its own case, since dropping it shifts every later flag onto the wrong value. `%VAR%` is deliberately excluded as a known cmd limitation pinned elsewhere. All green on real Windows; the one failure was a wrong assumption in the test itself (a PowerShell backtick escapes only inside double quotes), now recorded as both behaviors.

### Internals

- **Duplicate code reduced — `server/` and `src/` now share via `common/`** (#826, #827): jscpd's 4 duplicate-code alerts led to the real pattern behind them: values and wire types hand-mirrored between the two sides, even though `common/` is included by **both** tsconfigs and already carried `dirChrome` / `themeColors` / `modelPresets`. The mirroring was self-perpetuating — `firebase.ts` and `firebaseConfig.ts` each carried a comment claiming the server tsconfig cannot reach a shared module, which has not been true since `common/` existed. `firebaseConfig`, `Shortcut`/`ShortcutKind`/`sameShortcut`, `GitStatus`, `LaunchProviderOption`/`LaunchOptions`, the `GhItem`/`PrItem`/`IssueItem` family, and `EMPTY_DIR_CHROME` each have one definition now. `TEXT_EXTS` and `IN_APP_EXTENSIONS` share 45 entries but answer different questions, so only the intersection moved to `SOURCE_CODE_EXTENSIONS` and each side keeps its extras — both resulting sets are byte-identical to before, and `test/common/sourceExtensions.spec.ts` pins the deliberate asymmetries (`.md` routes to the rendered viewer, `.txt` opens in Files, dotfiles are server-only) so the next reader cannot "fix" them into symmetry. `AppRouteDeps` and `HookDeps` restated the same 7 callbacks and now extend one `SessionActivityDeps`; `TerminalCell` reuses the existing `CellChromeButtons` while keeping its own confirming close. Behaviour-preserving throughout, `-344 / +98` lines.
- **Every spec is type-checked now** (#826): `tsconfig.test.json` and `tsconfig.test-server.json` had been missing `test/scripts/**` and `test/*.ts` all along.
- **`CLAUDE.md` and `README.md`** record the `common/` rule that the mirrored copies violated, so the next shared value lands in the right place.

### Dependencies

- `@mulmoclaude/core` 1.3.0 → 1.5.0, `collection-plugin` 1.0.2 → 1.1.1, `google-plugin` 1.0.2 → 1.2.0, `mulmoscript-plugin` 1.1.1 → 1.1.2, `accounting-plugin` / `chart-plugin` / `html-plugin` / `markdown-plugin` → 1.0.3, `form-plugin` 1.0.1 → 1.0.2, `x-plugin` 1.0.0 → 1.0.1, `@mulmobridge/web-push` 1.0.0 → 1.0.1, `@receptron/task-scheduler` 1.0.0 → 1.0.1 (#824).

## mulmoterminal@1.11.1 — 2026-07-26

### Windows

- **A session on an npm-installed Claude Code starts again** (#813, #814): the `--settings` JSON arrived at `claude` with nearly every quote gone — `Error: Settings file not found: {"hooks:{UserPromptSubmit:[{hooks:[{type:command,command:curl` — and the session exited immediately. `--settings` and `--mcp-config` are now written to a file and only the *path* is passed, so nothing claude is launched with contains a quote at all. There is a test asserting exactly that over the argv a real spawn builds. POSIX is untouched and stays inline.

  The diagnosis is worth recording, because the first attempt at it was wrong. The escaping added in 1.9.2 (#801) emits cmd.exe's own `""` doubling, and that is delivered intact — a test now asserts the **raw command line** the shim receives, and it still holds `""hooks""` and `-d @- >/dev/null 2>&1` unaltered. So neither `cmd-escape.ts` nor cmd.exe was corrupting anything. What drops the quotes is the **receiving program**: `""` inside a quoted argument means one literal quote to the Microsoft CRT, and Claude Code's `claude.exe` is a native binary that does not implement that extension. The reporter's own data said so from the start — `\"` worked and `""` did not, in the same shell against the same binary.

  The CI test that had passed was itself the reason this took two rounds: it read the *parsed argv* of its child, and its child was `node.exe` — the most forgiving argv parser on Windows. The one assumption it never checked was its own stand-in for the real target. It now asserts what cmd delivers rather than what node forgives, and carries a shim of both shapes `cmd-shim` generates. Diagnosis credit to @chikara813, who posted the shim's contents and read `cmd-shim`'s source rather than assuming a version difference.

  The escaping rule itself is still wrong for a non-MSVC target and is tracked in #819; after this change the only argument that can carry a quote in a normal spawn is a background chat's initial prompt.

### Tests, docs & dependencies

- **A Windows CI flake removed** (#816, #817): `streamFile.spec.ts` waited 20 ms for real file I/O and asserted an empty buffer when a loaded runner took longer. It now waits for the stream outcome itself, which also catches a request whose bytes arrive but whose response never ends. Test-only change.
- **`CLAUDE.md`** (#815): the repo's agent-facing conventions, in the file an agent reads first.
- `@codemirror/state` 6.7.1, `@codemirror/lang-markdown` 6.5.1 (#818).

## mulmoterminal@1.11.0 — 2026-07-25

### Clicking a file path in terminal output

Terminal output is full of file paths, and clicking one used to do the same thing whatever it was: serve the bytes. A `.md` opened as markdown source, a `.csv` as a wall of commas, a `.ts` as text. Each kind now opens as the thing it is (#808).

- **Markdown renders** (#809): the "another model" help had always said a key belongs in a `.env` — and the Files overlay had always previewed markdown properly — but a clicked `.md` went to the raw route, which serves it as `text/plain`. It now goes to the route the overlay uses. The rendered page also stopped being hardcoded light: it opens in its own tab under a sandbox CSP and so cannot ask the app which theme is on, so it follows the reader's system setting instead of flashing white.
- **JSON is indented, CSV/TSV become a table** (#810): Chrome and Safari show a raw JSON file as one long line. A delimited file becomes a real table with a sticky header that scrolls inside its own box, so a wide one never pushes the page sideways. The CSV parser is written out rather than pulled in — the RFC 4180 rules are small enough to state exactly, and a loose parser silently splits a field in half, which is a wrong table nobody notices. Its output was cross-checked against Python's `csv.reader`, including the case where a quote preceded by spaces does *not* open a quoted field; that agreement is pinned as a test. Unparseable JSON and an unterminated quote both show what the file actually holds rather than an error, since that is exactly when someone opens the viewer.
- **Source opens in the Files view** (#811): a browser tab can only show source as bytes, and the app already highlights and edits it. A clicked `.ts` / `.py` / `.sh` / `.yaml` (about forty extensions) now opens in the Files view instead of a tab — no new dependency, since the highlighting is the editor's own. The alternative was a server-side highlighter, which the sandbox CSP forces, and that means a package for something the app can already do. Highlighting today covers the JS/TS family, JSON and Markdown — the modes `cmEditor.ts` bundles; other languages open as plain text.
- **`/files` gained `?path=`**: the file being edited now rides the URL like the project root already did, so a Files view is linkable and survives a reload.

Images, PDFs, SVGs and HTML keep opening in a tab — the browser renders those better than an editor would.

### Path containment

- **One gate for both file entry points**: the raw route and the browse routes had written the same containment out separately and drifted — the raw one expanded a leading `~`, the browse ones did not. It never mattered while every clicked path went to the raw route; sending source files to the browse routes made it reachable, so a line printing `~/proj/src/main.ts` would have opened onto a 403. `resolveContained()` in `files/pathContainment.ts` is now that gate, and both call it. Containment itself is unchanged: a tilde expanding outside the base is still refused, as are `..`, an absolute path, and a symlink leaving the base.

## mulmoterminal@1.10.0 — 2026-07-25

### Configuration

- **`npx mulmoterminal` now reads the `.env` in the directory you run it from** (#795, #806): the "Running a session on another model" help says a key belongs "in the shell that starts MulmoTerminal, or a `.env` beside it". That was true of a dev launch and false of every real one — `yarn server` passes `--env-file-if-exists`, the npx launcher never did, so a key written into `.env` never reached the server and the provider stayed unusable with nothing to explain why. The launcher now passes the flag with an **absolute** path: its spawn runs with `cwd` set to the package directory, where a relative `.env` would be looked for inside `node_modules` and quietly not found. The file is read from where the command was typed, not from the workspace — the two are the same directory unless `--cwd` says otherwise, and there the shell's directory is what the help promises and what the user can see.

  Two behaviours were measured rather than assumed, since both decide what a key ends up being, and both are pinned as tests that spawn the real `node`: a name already set in your shell is **not** overridden by `.env`, and with several `--env-file` flags the last one wins. Note that `.env` values reach the `claude` / `codex` sessions too, since a session inherits the server's environment — already true of a dev launch, now stated in the README instead of left to be discovered.

### Windows

- **One path-containment rule, and the three callers it was broken in** (#802, #803): `target === base || target.startsWith(base + path.sep)` was hand-rolled in eight places, plus a ninth doing the same job with `===`. Six were safe only by construction — the target is derived from the base with `path.resolve(base, rel)`, so the prefix is the same bytes — and every place where the two sides came from *different* sources was wrong on Windows. `worktreeTask` resolved the cwd but not the root, so `C:\home\u\…` was compared against an unresolved `\home\u\…` and never matched (this was the daily Windows job's standing failure). `authorizedServingBase` compared a browser-supplied directory against stored session cwds with `===`, so a differently-cased spelling of one directory refused raw file serving. `isManagedWorkspace` did the same against `os.homedir()`, so a differently-cased workspace silently skipped preset/help seeding.

  `server/infra/path-within.ts` now owns the rule — both sides resolved, case folded on win32 only (a case-sensitive APFS volume is a supported setup, and widening a containment guard on a guess is the wrong direction), and the separator boundary kept so `…/project-old` is not inside `…/project`. `platform` is a parameter, so both arms are checkable from any host: `path.resolve` is itself platform-dependent, which is what broke. `isManagedWorktree` keeps its deliberate asymmetry through `isStrictlyWithin` — the worktrees root holds worktrees but is not one, so a delete aimed at the root must not pass.

- **The Windows CI job is green for the first time**: with the above fixed and the `fs.watch` reload case skipped there (it passes on one Node version and fails on the other for the same commit, and a job that is red half the time hides the regressions it exists to catch), `windows-daily` passes on Node 22 and 24. A red run now means a real regression.

- **`docs/windows-gotchas.md`**: the traps this repo has actually hit, each with where the fix lives — `CreateProcessW` running PE images only, node-pty's exact-name PATH lookup and its empty error message, cmd.exe's second parse of the command line, `path.resolve` drive qualification, case folding, 8.3 short paths, and env-name casing. A test file already pointed at this document; it did not exist.

### Docs & dependencies

- **The terminal scrollback / selection FAQ entry was wrong** (#782, #805): it blamed a "renderer generation mismatch", which the investigation ruled out. The cause is that tmux owns the scrollback and splits by cell type — a shell cell keeps real history in the main buffer and can be drag-selected, while a Claude/Codex cell runs on the alternate screen with `history_size = 0` and redraws its own transcript, so its scrolled-off history cannot be drag-selected in **any** terminal (VS Code and iTerm included). The OSC 8 half of the entry was fixed in 1.9.1 and is dropped. The practical workaround — redirect long output to a file and open it in the browser viewer — is now written down.
- Dependency bumps (#807): `@mulmoclaude/*` plugins to 1.0.2 / core 1.3.0 / mulmoscript-plugin 1.1.1, `@mulmoclaude/x-plugin` and `@receptron/task-scheduler` and `@mulmobridge/web-push` to 1.0.0, `mulmocast` 2.9.2.

## mulmoterminal@1.9.2 — 2026-07-25

### Windows

- **npm-global installs spawn too** (#798, #801): 1.9.1 fixed the Claude Code installer's shape (`claude.exe` on PATH). This covers the other one — `npm i -g` leaves only `claude` (a shell shim), `claude.cmd` and `claude.ps1`, with no `.exe` at all. `CreateProcessW`, which node-pty ultimately calls, runs PE images only, so both variants of that install failed: the `.cmd` alone never satisfies node-pty's existence gate (`File not found: `, empty), and with the extensionless shim the gate passes but `CreateProcess` then looks for a `claude.exe` that isn't there (`Cannot create process`). A batch target now runs under `cmd.exe /d /s /c`, decided in the same single place as 1.9.1's fix, so `claude`, `codex`, `tmux` and the launcher all inherit it. Setting `CLAUDE_BIN` to an explicit `.cmd` path — the workaround #794 documented — is wrapped as well.

  Two things are deliberate here. `.exe`/`.com` still wins across the **whole** PATH before any `.cmd` is considered, rather than cmd.exe's per-directory order: an install whose shim sits in an earlier directory than its real `.exe` runs the `.exe` today and must not silently gain a parsing layer. And the argument escaping is cmd's, not the CRT's — `\"` does not escape a quote for cmd, it *ends* the quoted run and hands the rest of the argument to the parser, which is the injection this has to prevent. Every argument is quoted, internal quotes doubled, a trailing backslash run doubled, and NUL/CR/LF rejected outright rather than mangled. `%VAR%` expansion remains (cmd has no escape for it inside quotes) and is pinned as a test; rejecting every argument containing a percent sign would break ordinary prompts, and substituting our own child's environment into its own argument is a correctness wart rather than a privilege boundary. Rust hit the same wall in CVE-2024-24576, and Node answered CVE-2024-27980 by refusing to spawn `.cmd` without a shell at all.

  The escaping is verified empirically, not on paper: the Windows CI job builds a shim shaped like npm's (`node "…cli.js" %*`) and asserts the child's `process.argv` matches what was passed — JSON payloads (the real `--settings` / `--mcp-config` shape), `& | > ^ ( )`, embedded quotes, a trailing backslash, CJK, `50% done` — plus exit-code propagation through the extra cmd.exe process. Off Windows the resolution is inert: the same name, the same argv array, and no filesystem probe at all, pinned by its own test.

## mulmoterminal@1.9.1 — 2026-07-25

### Windows

- **Sessions start on Windows again** (#794, #799): every `claude` session failed with `File not found:` — nothing after the colon — while Codex sessions on the same host worked. node-pty gates each Windows spawn on its own PATH lookup (`src/win/path_util.cc`, `get_shell_path`), which compares file names **exactly** and never appends an executable extension, so a bare `claude` misses the `…\.local\bin\claude.exe` that the official installer produces and the failing path is the empty string. The name is now resolved to an absolute `.exe`/`.com` inside `spawnPty()` — the one function every PTY spawn goes through — so `claude`, `codex`, `tmux` (which has no `*_BIN` override of its own, and needed an extensionless copy of `tmux.exe` as a workaround) and `powershell.exe` are all covered at once. Only PE images are ever substituted: node-pty launches through `CreateProcessW`, which cannot run a `.cmd`, a `.bat` or an extensionless shell shim, so resolving to one would break the spawns that work today — that is exactly why Codex worked, its extensionless shim satisfied the gate while a `codex.exe` elsewhere on PATH was what actually ran. When nothing resolves, the bare name is passed through unchanged, so hosts that work today are untouched. The rule is covered by 16 pure tests on every OS, and the Windows runner now spawns a real PTY from a bare name and pins the upstream node-pty behaviour so a future fix there is noticed. npm-global installs that ship only a `.cmd` still need a `cmd.exe` wrapper and are tracked in #798.

### Terminal

- **OSC 8 hyperlinks are clickable again** (#783, #785): links in terminal output — Claude's statusline `PR #NNNN`, for one — did nothing when clicked. The cause was not the front end: **tmux was stripping OSC 8**, since it only forwards advanced sequences when the outer terminal is declared to support them (the same shape as the existing OSC 52 `Ms` override). `set -as terminal-features '*:hyperlinks'` is now written into our isolated tmux config and applied live to an already-running server. The browser side gained an xterm `linkHandler` that opens `http(s)` links directly instead of raising a `confirm` dialog.
- **Source and text files open in the browser instead of downloading** (#785): the raw-file route now serves `.md`, `.ts`, `.js` and friends as `text/plain`, so a file link from the terminal previews inline. Images, PDFs and media are unchanged, and unknown extensions still download.
- **Developer notes for the terminal stack** (#785): `docs/terminal-notes.md` records the xterm/addon version constraints, which behaviours come from which setting (with the issue that introduced them), the tmux passthrough rule, and a regression checklist to walk before an xterm upgrade.

### Support & docs

- **A bundled `/mulmoterminal-bug-report` skill** (#793, #797): its goal is to get the user unstuck, not to file issues. It hears out the symptom one question at a time, checks whether the behaviour is configuration or by design by **reading the real config, schema and version** rather than guessing, searches existing issues (a fixed-but-outdated version ends in an update instead of a report), and only then collects the environment — keys masked, full preview and consent before posting. Its `faq.md` is an index that deliberately stores no values, only config keys and source paths, and CI verifies every entry still points at a key and a file that exist.
- **npx cache corruption troubleshooting** (#735, #796): the `ERR_MODULE_NOT_FOUND` startup failure caused by an interrupted first `npx` install is now documented in the README and the docs landing page, so it is reachable by search rather than only from the changelog and the launcher's own hint.

### Dependencies

- `concurrently` 10.0.3 → 10.0.4, `eslint` 10.7.0 → 10.8.0 (#800).

## mulmoterminal@1.9.0 — 2026-07-25

### Phone / remote host

- **`getTerminalScreen` now carries the session's identity** (#786, #789): the response ships `cwd`, `branch`, `summary` (the AI header title) and `prompt` (the last meaningful user prompt) beside `screen` and `suggestion`, so the phone's per-session view (receptron/mulmoserver#107) can head the terminal with what the grid cell shows. Every field is optional and a value the host cannot answer is omitted key and all — the response is written to a Firestore command doc, which rejects `undefined`, and a blank labelled row on the phone would read as "no branch" rather than "not known". The metadata read runs concurrently with the screen capture (the branch lookup shells out to git), and a failure there costs the metadata, never the screen. A session that outlived a host restart has no PTY left, so it sends the screen alone, exactly as before.

### Grid cells

- **The expand ⤢ and close ✕ buttons look the same in every cell again** (#787, #788): in the launcher and command cells they rendered as browser-default buttons — a grey box with a rounded border, stretched vertically — while the Claude cell's were flat icon buttons and the ◀ ▶ beside them were fine. The cause was neither CSS nor the theme: `CellChromeButtons` renders a fragment root (two `<button>`s) and had no `<style>` of its own, so it carried no scope id at all — Vue hands the parent's scope id to a single root element only — and the shared, scoped `.cell-btn` / `.cell-close` rules matched nothing.
- **The shared cell chrome is now Tailwind utilities** (#791, #792): `cellChromeBase.css`, `cellChrome.css` and `CommandCell`'s own scoped block are deleted; their declarations live as utility strings in `cellChromeClasses.ts`, applied on the elements, so styling reaches a fragment-root component by construction. The `cell-*` class names stay as state and query hooks, carrying no styling. The status dot's pulse — the one thing a utility cannot express — moved into the Tailwind theme as `animate-cell-pulse`. Equivalence was verified by rendering every converted element twice, once with the deleted CSS and once with the new utilities, and diffing `getComputedStyle`: identical apart from an invisible border colour, `rounded-full` vs `50%` on a square dot, and the intended keyframes rename.

### Docs & dependencies

- **Why the canvas renderer is there, in the source** (#790): the `@xterm/addon-canvas` load site now records why it was introduced (the DOM renderer's CJK glyph metrics drift long Japanese lines off the right edge) and the trap that comes with it — the addon is an xterm-5 peer while the app runs `@xterm/xterm@6`, the prime suspect behind the selection-autoscroll / scrollbar (#782) and OSC 8 link-click (#783) regressions. Comments only; no behaviour change.
- **Deduplicated `@mulmoclaude/core`** (#784): `@mulmoclaude/mulmoscript-plugin` 1.1.0 requires core `^1.2.0`, which installed as a nested duplicate beside the root's 1.0.1. The root now takes `^1.2.0` and the lockfile is deduped so a single copy is hoisted — core carries backend service singletons and a native duckdb binding, where a duplicate is not harmless.
- `docs/styling.md` gained two gotchas learned here: a fragment-root component gets no scope id (so scoped CSS silently misses it), and two utilities for one property on one element are resolved by Tailwind's output order — compose one complete string per state instead.

## mulmoterminal@1.8.0 — 2026-07-25

### Terminal input & keyboard

- **Configurable submit / newline byte mapping** (#772): whether Enter *submits* or inserts a *newline* is decided by Claude Code from the received bytes, and that mapping is environment-dependent. A new global `terminalSubmit` setting (`"cr"` default, or `"esc-cr"`) selects which byte submits. It is honored across the browser keyboard, the phone remote-view submit, and GUI-originated sends (header `run:"input"`, skill invocation, the worktree commit prompt), and is scoped to **Claude sessions only** — shell/codex/command cells always submit with a plain `\r`, since `ESC+CR` is Alt+Enter to a shell. IME candidate-confirm Enter is never intercepted. The default `"cr"` is byte-for-byte the previous behavior. Documented in the [Configuration guide](https://receptron.github.io/mulmoterminal/guide/en/config.html#terminal-submit).
- **Clickable file paths in terminal output** (#778): file paths in output are linkified and open a browser preview via the raw-file route, scoped to the session's live cwd (`?cwd=` constrained to live session dirs).
- **Larger scrollback after reattach** (#776): the PTY replay buffer was raised (64 KiB → 1 MiB) so roughly 1000 lines of scrollback survive a reconnect.

### Header & grid

- **Richer default header buttons** (#775): the built-in starter set now adds 📁 browse files, 🖥 new terminal here, 🔗 this branch's PR (git repos, only when a PR exists), and 🌐 open on GitHub — alongside the existing insert-path / reveal. Setting `buttons` at any level still replaces the whole default set; this is now spelled out in the docs.
- **Zoomed-grid view-toggle placement** (#769, #771, #774): when a cell is expanded, the view-toggle no longer covers the cell's ✕ or the Settings button — it moved into the global header and sits at the right end next to Settings.
- **User-guide help links** (#770): the empty grid and the settings modal now link into the user guide.

### Worklog

- **Worklog header shortcut** (#765): a `#worklog` shortcut added to the grid view's right-hand icon group.
- **Weekly worklog pages indexed** (#773): weekly worklog pages register in `index.md` with a `#worklog` tag, so each page appears under the worklog filter.

### Fixes & docs

- **Phone terminal view lists grid sessions only** (#767).
- **Dev-server watch test flake on Windows** (#777): resolved an `fs.watch` flake by re-touching until restart.
- **Cross-repo PR/Issue view guide** (#763): new ja/en guide page.

## mulmoterminal@1.7.2 — 2026-07-24

A hardening release: a repo-wide code review turned up a family of real bugs across the server, the plugin runtime, the remote-host (phone) channel, and the git/worktree tooling. Each fix ships with a regression test.

### Server / backend

- **git worker deadlock & encoding** (#754, #743): `git()` never drained stderr, so a chatty `git worktree add` (git-lfs smudge errors filling the 64 KB pipe) deadlocked and wedged the worktree-create queue; stderr is now drained. Process output is decoded once so a multibyte UTF-8 character split across pipe chunks isn't corrupted (Japanese PR titles / branches / commit messages), and worktree diffs pass `-c core.quotePath=false` so non-ASCII paths read as themselves instead of octal escapes.
- **stream & external-call error/timeout gaps** (#755, #744): `GET /api/files/raw` and the `/artifacts/html` preview piped a read stream with no `error` handler, so a file that vanished or turned unreadable between stat and open crashed with an uncaughtException and hung the request; both now return 500 (or abort cleanly). Gemini image generation gained an abort timeout.
- **plugin fetch** (#757, #745): `allowedHosts` compares on hostname (a `localhost` pin now accepts `localhost:8080`), a caller-supplied AbortSignal is honored, the timeout covers the response body (not just the headers), and a redirect can't land the plugin on a host outside its pin.
- **startup, tmux, and mutate** (#759, #747): the launcher's readiness poll no longer forks on timeout into duplicate banners / browser tabs; `tmux cleanup-orphans` spares a session another mulmoterminal process is attached to; and a mobile-view edit whose (thumbnail-inlined) response exceeds the byte budget is reported as applied rather than a 4xx that showed the edit as failed and kept stale data.

### Remote host (phone) channel (#760, #746)

- Staged uploads are deleted only after the chat spawns, so a spawn failure (e.g. a missing provider token) leaves them intact for a retry; `Content-Type` parameters (`text/plain; charset=utf-8`) now map to the right extension instead of `.bin`; a leading UTF-8 BOM no longer hides a `SKILL.md`; attachment filenames use a full UUID (no 32-bit birthday collision that `rename()` would silently overwrite); and expired-command cleanup keeps its never-throw contract when a doc has no params.

### Worktree tooling (#762, #748 follow-up)

- `git diff <base>` no longer errors ("ambiguous argument") when a file is named after the base branch; re-running "create PR" opens the existing PR instead of the compare page; and removing a worktree deletes its branch even when the given path isn't realpath-canonical.

### Bundle of minor fixes (#761, #748)

- Model-preset context-length typo (`512_288` → `524_288`) and user-model dedup; empty upstream errors no longer narrate as a bare "Done"; a transient `gh` failure isn't cached as "no PR" for the TTL; the shipped config JSON Schema no longer requires all ~23 palette keys (a single-color write validates); plugin dispatch goes through a `Map` (a tool named `constructor`/`__proto__` 404s instead of resolving through the prototype chain); and a malformed/multi-range `Range` header is ignored (full 200) rather than answered 416.

### Other

- **npx cache recovery hint** (#736, #735): an npx install aborted mid-unpack leaves a half-unpacked cache entry that crashes the backend at boot with `ERR_MODULE_NOT_FOUND`; the launcher now detects that and prints an OS-appropriate, shell-quoted removal command so the fix is one copy-paste away.
- **dev backend auto-restart on crash** (#734): the dev supervisor restarts the backend on any crash so tmux-backed terminals self-heal, and watches `common/` and `bin/` (not just `server/`) for reload.
- **file drop no longer navigates away** (#752, #750): dropping a file anywhere in the window no longer replaces the page with the file.

## mulmoterminal@1.7.1 — 2026-07-24

A same-day patch undoing two 1.7.0 regressions and fixing a couple of terminal bugs.

### Regressions fixed

- **Grid resume picker lists all sessions again** (#758, reverts #724): 1.7.0 filtered the grid's empty-cell resume picker to grid-launched sessions only, so sessions started in the normal terminal / a plain `claude` disappeared from the grid picker. The picker again lists every session in the directory. (The chat sidebar's older behavior is unchanged.)
- **Wheel scrolls the terminal instead of spinning input history** (#738, #737): after the #729 mouse-tracking change, scrolling a zoomed terminal cycled the input history instead of scrolling the transcript. The wheel now scrolls; keyboard ↑/↓ still cycles history.

### Fixes

- **Corrupt `config.json` no longer wipes every setting** (#751, #741): if `config.json` was malformed, the next settings save discarded all existing settings; a corrupt file is now handled without data loss.
- **Codex session status tracking** (#753, #742): an interrupted turn could leave a codex cell stuck "working," and a deleted skill's mirror could linger.
- **tmux OSC 52 clipboard passthrough** (#749, #740): the tmux conf's double-quoting dropped `\E`, breaking clipboard copy from inside tmux.

### Docs

- **Animated hero GIF at the top of the README** (#756).

## mulmoterminal@1.7.0 — 2026-07-24

A resilience-and-cockpit release: one uncaught error can no longer take down every terminal, the cockpit roster gained reordering, shared directory-colored headers, auto-sort and proper scrolling, and the docs were audited end-to-end against the implementation — with the guide's highlights (roster, phone push, worktrees) now front and center.

### Reliability

- **One uncaught error no longer disconnects every terminal** (#732): the backend had no process-level `uncaughtException`/`unhandledRejection` guards and no `ws` socket error handler, so a single dropped client (`ECONNRESET`) could kill the whole server — every terminal's WebSocket died at once and, under `node --watch`, stayed dead. Process guards now log and survive, and a socket-error logger at the `handleUpgrade` choke point keeps one dropped client to one dropped client.
- **Terminal selection no longer sprays mouse-report noise** (#730, #729): selecting text in a cell whose program enabled mouse tracking could inject escape sequences into the input; selection now suppresses the reports.
- **Grid resume picker lists only grid-launched sessions** (#726, #724): externally started sessions (e.g. a dev terminal) no longer appear in an empty cell's resume list.

### Cockpit roster

- **Reorder rows from a ⋮ menu** (#708, #707): in manual sort mode each roster row gets a move-up/down menu.
- **One header for roster rows and strip thumbnails** (#711, #710): both render the shared `CockpitHeader`, so the directory's configured header color always applies.
- **Auto-sort reaches the roster** (#721, #720): the side list orders by attention the same way the grid does.
- **The roster scrolls instead of squishing** (#723, #722): many sessions now overflow into a vertical scroll rather than crushing rows.
- **`event` and `workPhase` on the session activity doc** (#728, #727): the activity doc now says whether a waiting session is blocked vs done, and whether a working one is planning vs editing — with a bounded tracker feeding the roster's status words.

### Tests & internals — #611 series

- **Decisions extracted from I/O and pinned by tests** (#712, #713, #714, #715, #716, #717, #718, #719): the Settings cost formatter, staged-attachment storage-id guard, terminal-input sanitize + clear-box gate, per-key TTL cache, remote attachment ingest ordering/failure safety, remote-host collection pagination, attachment path/naming rules, and the draft-vs-autorun decision are now pure, injected, and covered.

### Docs

- **Mobile push setup split by platform** (#731): the notifications guide now installs the PWA first on iPhone (an iOS 16.4+ requirement) and keeps the in-browser flow on Android; the README links both guide languages up top.
- **Full docs-vs-implementation audit** (#733): ~20 stale claims fixed — the 4-state status colors (amber is input-waiting only; a finished turn shows a blue ring), pushes fire even for the viewed pane and also on blocked turns, `cwdPresets` takes `{label, path}` objects, Run scripts launch in a spare cell, the 27 built-in provider models require `id: "openrouter"` — plus previously undocumented features (cockpit roster, PR-phase badges, ⇄ Exchange, model picker, in-app views) and new "Highlights" sections with real screenshots.

## mulmoterminal@1.6.0 — 2026-07-23

A large release: local models via Ollama, a provider/model picker when launching sessions, the first automatic cross-terminal review round, and update-awareness in the web header — plus a broad sweep of reliability fixes.

### Local models & backends

- **Run against a local Ollama model** (#692, #655): `claude-ollama` launches Claude Code against a local Ollama model, and a session can target it.
- **Pick a provider and model when launching** (#584, #579): choose the provider/model at launch, and run a directory's sessions on a chosen Anthropic-compatible backend.

### Codex sessions

- **Working / done straight from the rollout** (#582): a codex cell is flagged working and done by reading its rollout's turn boundaries.

### Cross-terminal review — #550 Phase 3

- **One automatic exchange between two terminals** (#595): hand a turn to a sibling terminal, wait for its answer, and relay it back — with a stop control, and without quoting the asker's own words back to them.

### Update awareness

- **Update-available badge in the web header** (#677): the header shows when a newer version exists; click it to see the exact update command.
- **git-clone users are told about updates too** (#654), not only npm installs.

### Terminal & grid

- **Ask before a second instance** (#653): starting a second instance now prompts instead of refusing.
- **Grid expand/collapse animations** (#682): every cell flips on expand/collapse (not just the zoomed one), filmstrip cells slide into place alongside the zoomed one, and each roster row shows a coloured status+dir header bar.

### Reliability

- **Stale out-of-order responses no longer overwrite live state** (#620 family, #673): a family of races where an in-flight GET's answer clobbered a newer live update — session feed, notifications, grid activity, the resume list, grid meta seeds, terminal usage badges, and the git-status chip — each fixed and pinned with a test.
- **Cross-process staleness in shared files** (#672, #705): two servers sharing one `~/.mulmoterminal` no longer drop each other's attention state, and a non-owning server re-reads a session's tool history instead of showing a stale copy until restart.
- **No orphan PTY on `/ws/run`** (#671): a viewer leaving during command resolution no longer leaks a shell process nobody reaps.
- **Preset models dedupe case-insensitively** (#674) so a differently-cased entry doesn't appear twice in the picker.

### Under the hood

Most of this release's ~119 merged PRs are internal refactors — an inventory that extracts I/O-buried decision rules into tested pure functions, and the completion of the `server/index.ts` split — and change no behaviour. They are deliberately not itemised.

## mulmoterminal@1.5.0 — 2026-07-22

Reading a terminal session from your phone landed in 1.4.0; this release makes it usable — you can type into a session, tap the agent's own suggestion, and get told when a session is *blocked* rather than only when it finishes.

### Your phone can drive a terminal session

- **Type into a live session** (#445, #446): send a line to any session attached on this host, framed as a bracketed paste with the Enter as a separate write so Claude's TUI doesn't drop it. Sends are chained per session, so two overlapping ones can't interleave into one merged command.
- **Send only what you typed on the phone** (#572, #573): a draft left in the input box on the host used to be submitted merged with the phone's text, with no separator — "yes I already typed this" + "ok" arrived as `yes I already typedthisok`. The box is cleared first now. Which key was measured, not assumed: Ctrl-U and Ctrl-A/Ctrl-K clear only the current *visual* row and leave a wrapped draft behind, Esc does nothing to it, and Ctrl-C empties it whole — riding in the same write as the paste, and a no-op on an already-empty box. The clear is withheld wherever the host can't vouch for the session: mid-turn Ctrl-C would interrupt the turn, in a shell it would kill whatever is running, and an absent activity record means "nobody has reported yet", not "idle".
- **Tap the agent's own suggestion** (#563, #565): Claude offers a follow-up prompt as dim ghost text you accept with Tab. Colour doesn't survive a capture, so on the phone it read as text already typed that nothing would send. The host now captures the pane *with* escapes, normalises it into rows carrying each row's dim run, and returns the suggestion beside the screen. A row qualifies only when everything past the caret is dim, so a real draft is never offered back.
- **The phone knows what each session is running** (#447): claude, codex or shell, so it can offer input that suits it instead of putting `ls` in front of an agent — and "unknown" stays distinguishable from "shell" rather than being guessed.
- **The screen follows the session** (#439, #442): the host publishes a revision to Firestore on every real transition, so the phone refreshes on its own instead of waiting to be asked.

### Notifications

- **Pushed when a session is blocked, not only when it finishes** (#472, #474): a permission prompt or a question is exactly the case where answering from your phone unblocks work, and you couldn't know about it otherwise.
- **A tap opens the session it came from** (#440, #443, #457): the push carries the session id *and* the host id, so it no longer lands on the host picker.
- **The body says what the agent did** (#549): the finished-turn push carries the reply itself — collapsed to one line, markdown flattened, links reduced to their text — instead of a generic "done".

### Hand a turn from one terminal to another

- **Pull another terminal's last turn into this cell** (#550, #566, #574, #576): take a sibling session's previous turn and continue it here, without a round trip through the clipboard.

### Reliability

- **Windows** (#478, #480, #485, #561): portable worktree / slug / temp handling, platform-agnostic dir-config write targets, and a Claude project-directory encoding that now matches upstream — that last one had been making `--resume` fail *silently*.
- **Scheduled runs no longer leak tmux sessions** (#541, #545): a scheduled session's tmux session is reaped along with it.
- **Sandbox spawns refresh the host Keychain token first** (#492, #494).
- **Launcher environment** (#449, #458): package-manager launcher env is sanitized before a PTY spawn, and PATH entries are matched on their last segment.
- **Theming**: command / launcher grid cells follow the app theme (#468), Settings warnings render red (#523), and global CSS sits in `@layer base` so utilities apply (#535).

### Under the hood

Most of this release's 115 merged PRs are internal and change no behaviour — the app's styling moved to Tailwind, `server/index.ts` was split into routed modules, and a long run of de-duplication landed. They are deliberately not itemised.

## mulmoterminal@1.4.0 — 2026-07-20

A phone can now view one of this host's terminal sessions, the cockpit roster gained workflow phases, and the output buffer no longer corrupts the screen restored on reattach.

### Features

- **View a terminal session from your phone** (#435, #436): two new remote-host handlers, `listTerminalSessions` and `getTerminalScreen`, let the mulmoserver PWA pick one of this host's sessions and read its current screen. Registering the handlers is enough to advertise the capability — presence derives it from the handler table — so no protocol change was needed. Screens come from `tmux capture-pane` where available (works while detached, survives a host restart) and fall back to rendering the session's buffered output through `@xterm/headless` for hosts without tmux, non-persistent spawns, and the race where a session ends mid-read. Both paths return plain text. The picker filters by the same resumable rule the orphan cleanup uses and drops sessions the host can no longer name unless they are live — the transcript-on-disk rule alone yielded 67 rows, 62 of them bare UUIDs, on the author's machine. Requires the companion UI, receptron/mulmoserver#71.
- **Workflow phases in the cockpit roster** (#428): the grid's zoom + list roster now shows where each agent's branch stands alongside its activity state.
  - **#429** — `server/git/prPhase.ts`: a pure `derivePrPhase` over `gh pr list` output (`none` / `draft` / `ci-failing` / `changes-requested` / `ci-running` / `ready` / `merged` / `closed`), a 30 s cache keyed by repo+branch, and `GET /api/pr-phase?cwd=`. No UI change.
  - **#430** — renders the phase beside each roster row, so a wall of parallel agents shows which are in review, waiting on merge, or merged.
  - **#431** — splits `working` into planning vs implementing from a pure `classifyWorkPhase(recentTools)`: mutation tools (Edit/Write/NotebookEdit) mean implementing, read/search-only means planning, Bash is neutral.

### Fixes

- **Output buffer truncation corrupted the restored screen** (#434): the 64 KiB tail was sliced by character count, so a cut could land inside an escape sequence and leave orphaned parameter bytes rendering as literal junk (`5;196m`) at the top of the screen restored on reattach. The shipped fix decides from the text that was *discarded* — it finds the last ESC before the cut and checks whether that sequence closed before it — rather than pattern-matching the retained side, which also matched ordinary text and silently corrupted it (`"5 files pending"` → `"iles pending"`, `"/api/v1/resource"` → `"pi/v1/resource"`). Two further bugs fell out of the rewrite: a clean cut now keeps every retained byte, where the earlier version resumed at the next newline or ESC and discarded the head of the tail even when nothing had been split; and a split OSC string is cut at BEL/ST rather than the first `0x40-0x7E` byte. The search for the opening escape spans the whole discarded prefix rather than a fixed window — this host enables OSC 52 deliberately (the `Ms` terminfo override forwards Claude Code's auto-copy to the browser clipboard), so kilobyte base64 payloads are a designed-for case and a 64-byte window lost the introducer, leaking base64 onto the screen.

### Chores

- **`@mulmoclaude/core` `^0.22.1` → `^0.23.1`** plus collection/google/mulmoscript plugin bumps (#432). A workspace-compatibility update rather than a routine one: a core older than 0.23 skips `dataSource` schemas at discovery, so CSV-backed collections created in MulmoClaude did not appear here at all.
- **`@mulmoclaude/core` `^0.23.1` → `^0.25.1`** and a port of record I/O onto the CollectionStore seam (#433). MulmoClaude can now create `storage: sqlite` collections whose records live in a single SQLite file rather than per-record JSON; the raw `readItem`/`writeItem`/`deleteItem` calls these backends used wrote to a phantom `dataDir`.
- **`@mulmoclaude/collection-plugin` `^0.13.2`** (#437): fixes outside-click dismiss for dropdown menus inside PluginFrame's shadow root, where `ref.contains(event.target)` is always false at document level because the event target is retargeted to the shadow host.

### Documentation

- **Screenshots in the README** (#438): seven images with end-user captions, taken from the Zenn guide. The README previously had no images at all.

## mulmoterminal@1.3.1 — 2026-07-18

### Chores

- **Dependency updates** (#427): `@mulmoclaude/collection-plugin` `^0.11.1` → `^0.12.0` (requires `@mulmoclaude/core@^0.23.0`, matching the current pin, so a single core copy still resolves), `@mulmoclaude/mulmoscript-plugin` `^0.2.1` → `^0.2.2`, and `@tailwindcss/vite` + `tailwindcss` `^4.3.2` → `^4.3.3`. No behavioural change.

## mulmoterminal@1.3.0 — 2026-07-18

Google integration matured end to end (OAuth + Calendar + broker, plus a Calendar extension for non-primary calendars and colours), dead-code / duplication detection added to CI, a symlink-escape hardening, and a large test-suite reorganization.

### Features

- **Google integration, end to end.** Link a Google account (local loopback OAuth, token shared with MulmoClaude) and drive Calendar from the chat `google` tool, the phone's `google.calendar.*` commands, and the mulmoserver broker: initial OAuth + Calendar + a PluginRuntime host for factory-style plugins (#389), host-neutral link guidance (#390), an npm two-copies fix so the published package resolves a single `@mulmoclaude/core` (#415), broker-based authentication (#421, tests #424).
- **Google Calendar extension — non-primary calendars + colours** (#426): `createEvent`/`listEvents` gain `calendarId` (default primary) + `colorId`, plus new `google.calendar.listCalendars` and `google.calendar.colors` commands, following `@mulmoclaude/core@0.23.0` / `@mulmoclaude/google-plugin@0.3.0`. **Existing links must re-authorize** (Settings → Google account → Unlink → Sign in, or `mulmoterminal google login`) for the new calendar-list / colour read scope; primary-calendar event read/create keeps working without re-linking.
- **jscpd copy/paste duplication detection** reported to Code Scanning (#405), later extended to also scan `.vue` files (#422).
- **knip cross-module dead-code detection** in CI (report-only) (#420).

### Fixes

- **FileOps symlink-escape hardening** (#416): the plugin containment guard now resolves symlinks (including dangling ones) so a planted symlink can't read/write outside a plugin's rooted dir.
- **Repaired broken imports in relocated test specs** (#418) that had turned main red.

### Refactors / Chores

- **Shared `THEME_COLOR_KEYS` across the server/client build boundary** via a new `common/` dir, shipped in the published package (#423).
- **Deduplicated the gh issue/PR normalizers** (#422) and added shared error-handling / spawn utilities (#409).
- **Test-suite reorganization**: moved every `*.spec.ts` from beside its source into a dedicated `test/` tree mirroring the source layout — bin, server/{config,agents,backends,files,git,session,infra}, src/{components,composables,router,utils} (#395, #396, #397, #398, #401, #402, #403, #404, #406, #410, #411, #412, #413, #414).
- **Housekeeping**: untracked accidentally-committed local config artifacts and gitignored them (#419); gitignore MCP / Playwright config (#393).

## mulmoterminal@1.2.0 — 2026-07-16

One-command first-run setup (`npx mulmoterminal init`), a bigger zoom hit-target in the grid, a server-directory reorg, and dependency updates.

### Features

- **`npx mulmoterminal init` — idempotent first-run setup** (#381): checks your environment (Node ≥ 22.9, the `claude` CLI, plus optional `tmux` / `gh` / `codex`), seeds the launcher's working-directory presets from the projects in your Claude Code history (reads each transcript's real `cwd`, keeps only dirs that still exist), and writes `~/.mulmoterminal/config.json` — preserving your other settings. Re-run any time; `--dry-run` previews without writing. When `claude` is installed it can hand off to the `/mulmoterminal-config` skill.
- **Zoom a grid cell by clicking its header background** (#378): a larger, easier hit target for zooming a cell in place; the grid also stays zoomed on a neighbour when the zoomed cell is closed (#376).

### Refactors

- **Server reorganized into role subdirectories** (#372, #373): `server/{config,agents,backends,files,git,infra,mcp,session,skills}/` — no behavior change.

### Chores

- **Dependency updates** (#370, #382): refreshed `@mulmoclaude/*` and other packages.
- **Docs / tidy**: the README now leads with the product's value proposition (#375); completed plan files moved to `plans/done/` (#371).

## mulmoterminal@1.1.0 — 2026-07-15

Grid launcher UX (a preset click fills the field and shows resumable sessions), a header Skill menu, reliable tmux teardown on explicit close with a safe orphan cleanup, and a session-summary caching perf win.

### Features

- **Preset dir click fills the field instead of launching** (#361, #362): clicking a directory preset chip in the grid launch form now fills the working-directory field and reveals the "or resume here" session list — so you can resume an existing session (or pick the agent / a worktree / a script) — instead of starting a fresh session immediately. A one-click quick-launch stays on the chip's ▶ button. (#362 also removes a redundant double-fetch of the resume / scripts / worktrees lists on fill.)
- **Header Skill menu** (#365): run a `.claude/skills` skill from a header menu, like the Run menu.

### Fixes

- **Explicit close now kills the tmux session** (#367): closing a cell with ✕ reliably kills its tmux session even when the socket is down or the session was orphaned by a prior server restart — the reap now goes over `POST /api/session/:id/terminate` instead of a socket-only message. Adds `POST /api/tmux/cleanup-orphans` that reaps only non-resumable orphan tmux sessions (never a live / grid / Claude-or-Codex-transcript-backed one); both routes are same-origin guarded. Fixes a tmux-session leak that had accumulated 126 sessions (cleared down to the resumable set on one run).

### Performance

- **Session transcript summary caching** (#369): cache the per-session summary and parse the transcript a single time, cutting redundant re-parsing.

## mulmoterminal@1.0.0 — 2026-07-14

First stable release. Web Push to your phone is now solid end-to-end — it fires for every finished turn (not just background ones), self-heals its RemoteHost connection after a server restart, and shares its send core with MulmoClaude — plus an opt-in cross-clone dev worklog.

### Features

- **Web Push fires on every finished turn** (#357): a push now lands even for the session you're actively viewing, not just background ones. The attention beep keeps its active-pane suppression (you're already looking at it); only the push ignores it.
- **Self-healing RemoteHost session** (#359): after a server restart (dev `--watch`, crash, redeploy) the browser silently re-pushes its parked session on socket reconnect / tab refocus / network restore, so Web Push no longer dies while the UI still shows "connected" — with no manual reload. Previously the re-push only ran on page load.
- **Cross-clone dev worklog** (#352): an opt-in built-in system task (`worklogEnabled: true`, default OFF) periodically summarizes what you built — across every clone of a repo, organized per repository, including decisions discussed-but-not-implemented — into browsable wiki pages, built on the shared scheduler and wiki. The aggregation window is `[lastRunAt, now]`, so nothing is dropped when the machine sleeps past the interval.

### Refactors

- **Shared Web Push send core** (#355): the `sendPush` wire contract now lives in the shared `@mulmobridge/web-push` package (auth injected, no firebase dependency), so MulmoClaude and MulmoTerminal can't drift when mulmoserver changes the contract. Pure refactor — no behavior change.

### Docs

- **Mobile Web Push setup guide** (#350): a new guide page (Japanese + English) covering the terminal side (RemoteHost Connect + the "Notify my devices when a task finishes" toggle) and the phone side (the mulmoserver PWA — same Google account, enable notifications, add to home screen).
- **Dev worklog how-to** (#353): documents enabling (`worklogEnabled: true` in `~/.mulmoterminal/config.json`) and viewing (the "作業ログ 一覧" hub page or the `#worklog` wiki tag).

## mulmoterminal@0.9.3 — 2026-07-14

RemoteHost login now survives a server restart (the session is parked in the browser), which also keeps Web Push working across restarts; plus a fix for the Web Push toggle in the grid view.

### Features

- **RemoteHost login survives a server restart** (#346): the RemoteHost Firebase session is parked in the browser (localStorage) and restored on reconnect, so restarting the server no longer forces a Google re-login — the client silently reconnects from the parked session (case A' of receptron/mulmoserver#50, via `@mulmoclaude/core@0.13.0`'s export/seed-able session controller). This also keeps Web Push working across restarts, since push needs the RemoteHost connection for its notification auth.

### Fixes

- **Web Push toggle wasn't saved in the grid view** (#348): the grid view renders its own Settings modal, which was never wired for the "Notify my devices when a task finishes" toggle — so in the grid it showed unchecked and didn't persist. It now reflects and saves the setting like the single view does.

### Chores

- **Tidy** (#349): moved completed plan files to `plans/done/`.

## mulmoterminal@0.9.2 — 2026-07-13

Web Push notifications when a background task finishes, a native folder picker for launcher working directories, and a set of correctness fixes: cross-instance config safety, attention state restored across a restart, and grid rendering.

### Features

- **Web Push on task completion** (#339, #340): a background session sends a Web Push notification when its task finishes, so you're pulled back even when you're not watching the tab. Hidden/internal worker sessions are excluded from the push.
- **Pick the working directory via an OS dialog** (#334, #335): a cell launcher can choose its working directory through a native folder picker instead of typing the path.

### Fixes

- **Config no longer clobbered across instances** (#337, #338): `POST /api/config` now read-modify-writes `~/.mulmoterminal/config.json`. With several mulmoterminal instances sharing that file, saving settings in one instance could previously overwrite header buttons/chips another instance had written; the save now merges onto the current on-disk config so those edits survive.
- **Attention state restored across a restart** (#342, #343): working / waiting activity is restored on boot so grid cells don't drop to idle after a server restart.
- **Grid cells no longer blank on reattach** (#344, #345): the terminal repaints on reattach / reactivation, fixing blank cells when returning to a grid.
- **Grid focus-zoom clipping** (#331, #332): the focus-zoomed cell is kept on screen so edge characters aren't clipped.

### Chores

- **Tidy** (#333): moved completed plan files to `plans/done/`.

## mulmoterminal@0.9.1 — 2026-07-12

Grid-view release: configurable header action buttons, a text roster ("cockpit") beside the expanded terminal that always summarizes on our side, and attention-signal correctness fixes for off-page and post-restart cells.

### Features

- **Configurable header action buttons** (#319 via #320/#323/#324): the terminal header's action buttons are now config-driven with sensible defaults — a **file-path picker** plus **"reveal in the OS file manager"**, a **"new terminal"** button that opens a `$SHELL` cell adjacent to the current one, and an **"open PR"** button shown only when the current branch has an open pull request.
- **Grid cockpit — text roster** (#325): beside an expanded grid terminal, a dense text roster lists every session — directory, AI summary, current prompt, latest reply, and a word status (running / waiting / done / idle). Click a row to switch which terminal is enlarged; toggle between the list and the old thumbnail strip.
- **Roster self-titling / fresh summaries** (#327): the grid roster now always summarizes on MulmoTerminal's side rather than surfacing a stale externally-written title, regenerating the summary from the current transcript for sessions it didn't launch (unmanaged, resumed, or after a server restart), gated by in-flight and retry-backoff guards.

### Fixes

- **Grid attention signal reaches on-screen cells** (#322, #321): the "waiting for input" attention signal is now surfaced for cells currently on screen in the grid.
- **Off-page and post-restart attention state** (#329, #321): off-page grid-cell attention is routed through `/api/activity`, and blocked/done attention state now persists across a server restart.

### Chores

- **Tidy** (#328): moved the completed plan file to `plans/done/`.

## mulmoterminal@0.9.0 — 2026-07-12

Grid-view–focused release: smoother top-tab navigation (the grid is kept mounted, flicker-free), clearer active-cell feedback, AI-summarized cell-header titles, and live theming — plus several correctness fixes, a config-authoring skill, and docs.

### Features

- **Persist the grid across top-tab switches, flicker-free** (#318): switching top tabs and returning no longer rebuilds the grid. It's kept mounted (`<KeepAlive>`), so you come back to the exact same state — same cells, same zoom, even a half-typed command line — with no re-render, re-fetch, or re-fit. The cell that last held the cursor regains focus automatically, and per-directory palettes are seeded from cache so a returning cell never flashes the default theme for a frame. (Terminal connections already persisted; this removes the visual churn on top.)
- **AI-summarized title in the cell header** (#317, #316): once a session becomes a back-and-forth, the raw last prompt is a poor label. Recent turns are now summarized by a cheap model (Haiku, overridable via `MT_TITLE_MODEL`) into a short AI title shown in the cell header and the session list, falling back to the last prompt when no title exists yet.
- **Zoom the active grid cell in place on focus** (#310): the keyboard-focused terminal lifts and grows slightly, in place, so the active cell is obvious at a glance — via a CSS `transform: scale` that keeps text crisp and never changes the cell's layout box, so xterm is never refit and the PTY is never resized as focus moves between cells.
- **Zoom the new cell when adding a terminal while zoomed** (#313): pressing "+ Terminal" while a cell is expanded promotes the new cell into the enlarged view, so you configure and launch it where you're already looking instead of hunting for it in the filmstrip.
- **Animated expand/restore (FLIP)** (#298): zooming a grid cell animates from its grid slot to the enlarged view (and back) with a transform-only FLIP, so xterm refits once rather than every frame. Honors `prefers-reduced-motion`.
- **Live-reload `.mulmoterminal.json` — no filesystem watchers** (#303): editing a directory's `.mulmoterminal.json` recolors its terminals immediately, with no page reload, no server restart, and not a single fs watcher — the server already observes every write via Claude's `PostToolUse` hook, so the writer announces the change and nothing polls.
- **`mulmoterminal-config` skill (zod-backed)** (#297): a new `/mulmoterminal-config` skill authors a valid `.mulmoterminal.json` from a short conversation — for the current directory or a batch of recent directories — so nobody hand-writes the color/DSL config. The DSL is now defined once in zod (`z.infer` types + runtime validation + a shipped JSON Schema); the skill installs into the global Claude and Codex skill roots on boot and is launchable from a new toolbar button.

### Fixes

- **Canvas renderer stops CJK drift** (#315): long Japanese lines drifted past the terminal's right edge (English wrapped fine). xterm now uses the canvas renderer, drawing every glyph in its own fixed-grid cell, so per-glyph advance-width mismatch (common once JetBrains Mono is installed and the OS CJK fallback's width differs) can no longer accumulate.
- **Resume on-disk sessions even when a tmux session is alive** (#305): opening a past session could fail with `Session ID … is already in use` — claude's own error when `--session-id` is used for an id that already has an on-disk transcript. The server now always uses `--resume` for on-disk transcripts regardless of tmux liveness, so a tmux session that died between the check and the spawn (a reap, an `/exit`, or another instance on the shared tmux server) no longer aborts the launch.
- **Refocus the grid terminal after expand/collapse** (#312): expanding (⤢) or restoring (⤡) a cell teleports it in the DOM, which blurred the xterm textarea — you had to click before typing. The cell that should be active now grabs focus automatically via the lightweight `conn.focus` (no socket reconnect).
- **Pin expand/close to the top-right when header info overflows** (#300, #299): when the header's first row (name badge / git branch / model·context / tokens) grew, it pushed the ⤢ and ✕ buttons off-screen. The info now lives in an overflow-clipping track with the action buttons as a fixed sibling, so overflow clips the info chips (right-most first) while the buttons always stay put.

### Refactoring, chores & docs

- **Drop `trackStyle`'s dead zoom argument** (#301): a leftover parameter and `0fr`-collapse branch from a superseded pre-FLIP zoom approach — reachable only from its spec — were removed; behavior unchanged.
- **Dependency update** (#307): refreshed `package.json` / `yarn.lock`.
- **Grid-view user guide on GitHub Pages, JA/EN** (#295): a user-facing guide (`/docs`, just-the-docs) that leads with the product concept — a terminal-first environment where one engineer supervises many parallel AI agents — organized around the Supervise / See / Automate-&-investigate pillars, then teaches the grid view.

## mulmoterminal@0.8.0 — 2026-07-09

Feature release: **Codex as a first-class agent** in the single view, a **configurable terminal header** (custom action buttons + display chips driven by JSON), **per-directory cell colors**, and a layer of **agent-state visibility** (git chip, model/context badge, estimated cost, tool-call timeline, AI command summaries).

### Highlights

- **Codex is a first-class agent, at parity with Claude in the single view** — Codex now drives the GUI panel (charts / forms / collections / images) through its own tool calls, appears in the **sidebar** with a `codex` badge, and its past conversations are **listable and resumable** (from `~/.codex` rollout files; `codex resume <id>` over `/ws/codex`). The collection browser gains a persisted **“Launch with” [Claude | Codex]** toggle, and mulmoclaude skills work in Codex (workspace `.claude/skills/*` mirrored to `~/.codex/skills/*`; `/<slug> <msg>` rewritten to `Use the "<slug>" skill. <msg>`). (#240, #249, #257)
- **Configurable terminal header (buttons + chips via JSON)** — the running terminal’s header is user-configurable from the existing config files (project `<cwd>/.mulmoterminal.json` + global `~/.mulmoterminal/config.json`, merged); **with no config it’s identical to before.**
  - **Action buttons** (`buttons`): `run:"input"` types text into the live session (e.g. `/compact`); `run:"open"` opens `url` / `reveal` (Finder) / `files` (in-app explorer) / `view` (prs/wiki/collections/accounting); `run:"shell"` runs `cmd` in a command cell (server re-resolves by id, `${vars}` shell-escaped, `cmd` never sent to the browser). `${var}` = dir/branch/repo/ahead/behind/dirty/agent/model/task; `when` = `isGitRepo` / `agent == …` / `repo == …` with `&&`/`||`. (#285, #288)
  - **Display chips** (`chips`): reorder/hide the grid cell header built-ins (`git`/`diff`/`ctx`/`usage`) and add custom `{ label, text, when }` chips. `chips: null` (default) renders as before. (#290)

    ```json
    {
      "buttons": [
        { "id": "compact", "emoji": "🗜️", "label": "Compact", "run": "input", "text": "/compact", "when": "agent == claude" },
        { "id": "gh", "emoji": "🌐", "label": "Open on GitHub", "run": "open", "open": { "url": "https://github.com/${repo}" }, "when": "isGitRepo" },
        { "id": "build", "emoji": "🔨", "label": "Build", "run": "shell", "cmd": "yarn build" }
      ],
      "chips": ["ctx", "git", { "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }]
    }
    ```
- **Per-directory cell colors** — `headerColor` / `headerTextColor` (#280) plus `cellColor` / `cellBorderColor` / `dotColor` / `buttonColor` (#283) in `.mulmoterminal.json` (all `#rrggbb`) so each project’s terminal is visually distinct; the working/blocked status tint still overrides the background while active.

    ```json
    { "headerColor": "#0b3d2e", "headerTextColor": "#e2f5ec", "cellColor": "#0e1117", "cellBorderColor": "#1f6f4f", "dotColor": "#22c55e", "buttonColor": "#a7f3d0" }
    ```
- **Know what your agents are doing** — a **git status chip** in every header (`⎇ branch ●dirty ↑ahead ↓behind`, #248); a **model / context badge** (`Opus · ctx 35%`, #255); **estimated cost ($)** Session/Today/This-month in Settings (#256); an **activity timeline** 🕘 of tool calls (#250); and **AI Summarize/Explain** ✦ of Run-cell output with **⧉ Copy as prompt** (#251, #268).

### Also

- Launcher preset chips are tinted when their dir already has a running session (#259); the two-row cell header was tidied (info on row 1, action icons on row 2) (#261, #270); clicking a filmstrip thumbnail’s header whitespace zooms/switches to it (#253).

### Fixes

- **Shift+Enter inserts a newline** (send `\x1b\r`; a later xterm `preventDefault` regression also fixed) (#264, #293); **macOS Option acts as Meta** for Claude’s Alt bindings (#266); **per-model context window** in the ctx% badge (1M for current-gen models, was showing 470%) (#276); **header prompt resets on `/clear`** (hooks tagged with a stable `x-mt-session` id since Claude reissues `session_id` on `/clear`/`/compact`) (#292); files view returns to its originating view (#272); grid zoom / filmstrip header polish (#275, #278).

### Docs

- README refreshed for the current app (Claude & Codex, worktrees/PRs, cost & tokens, Wiki/Collections/GUI panel, endpoint tables) plus tmux install instructions (#286).

📦 **npm**: [`mulmoterminal@0.8.0`](https://www.npmjs.com/package/mulmoterminal/v/0.8.0) — `npx mulmoterminal@latest`

## mulmoterminal@0.7.0 — 2026-07-08

Feature release: an opt-in **Docker sandbox** for the single-view Claude session, **Codex as a first-class agent** alongside Claude, user-configurable MCP servers, more remote-host (phone client) capabilities, and terminal clipboard/scroll fixes.

### Highlights
- **Docker sandbox for the single-view Claude session (opt-in)** (#205, #208, #211, #221, #222): run `claude` inside a container so it can't reach the host filesystem outside the bind-mounts, host processes, or arbitrary host ports (the project dir and `~/.claude` are bind-mounted read-write by design). macOS-only, opt-in via `MULMOTERMINAL_SANDBOX=1`. Authenticates from the macOS **Keychain** (the live credential is exported read-only into the container and **re-synced on every reconnect**), reaches the host GUI MCP over `host.docker.internal`, and **auto-builds its image on first run** from the shipped `Dockerfile.sandbox` (rebuilds when the Dockerfile changes). Opt-in host credentials — `gh`, `.gitconfig`, SSH agent — via a fixed allowlist (`SANDBOX_MOUNT_CONFIGS`), all mounted read-only.
- **Codex as a first-class agent** (#237, #238, #239): a new `AgentAdapter` seam lets MulmoTerminal drive agents other than Claude, with Codex as the first. First-class Codex sessions on `/ws/codex` (spawn, discover, resume by rollout id), a **Claude / Codex toggle** in the grid cell launch form, and the client protocol to connect them.
- **User MCP servers for the single-view session** (#207): configure your own MCP servers for the interactive Claude session.
- **More remote-host (phone client) capabilities** (#227, #228, #229): `listSkills`, `getFeed`, and offline-queued `startChat` (protocol v2).
- **Terminal clipboard & scroll fixes** (#206, #214, #215): OSC 52 copy now reaches the browser clipboard — including **through tmux** (Claude's auto-copy in grid terminals) — and the grid-terminal mouse wheel now scrolls the buffer instead of cycling shell history.

### Also
- **Collection action fixes**: pass collection paths to action seed prompts (#212); deliver auto-run prompts by typing rather than a tmux-overflowing CLI arg (#213).
- **Code quality**: function-size + complexity ESLint guards promoted from warning to error, with the offending functions refactored to satisfy them (#225, #230, #231, #232, #233, #234, #235).
- **Dependency bumps**: `@mulmoclaude/accounting-plugin@0.3.2`, `@mulmoclaude/core`.

📦 **npm**: [`mulmoterminal@0.7.0`](https://www.npmjs.com/package/mulmoterminal/v/0.7.0) — `npx mulmoterminal@latest`

## mulmoterminal@0.6.2 — 2026-07-04

Feature release: a cross-repo PRs & Issues view, selectable launch commands, a full-screen file explorer + Markdown editor, and tmux-backed session persistence.

### Highlights
- **PRs & Issues view** (#183, #187, #190): a full-screen **Pull requests & Issues** view (toolbar `call_merge` button) that aggregates open PRs **and** issues across multiple repositories via your server-side `gh` login. Configure `owner/repo` entries in Settings → Pull request repos. PRs show CI rollup / review decision / draft badges; each repo lists its latest 20 open issues with a link to the rest on GitHub. Rows are real links (right-click / ⌘-click / middle-click work). Per-repo errors never sink the view, and the two endpoints load independently.
- **Launch commands in the grid cell launcher** (#182): a grid cell can launch **any configured program besides Claude** — a plain shell, `codex`, any interactive command — set in Settings → Launch commands as `{ label, command }` (e.g. `Shell` → `$SHELL`). A launcher runs as a **persistent, reattachable terminal** in the cell's directory (survives page switches / reconnects); its dot shows running vs. exited.
- **Full-screen file explorer + Markdown editor** (#184): every terminal header has a 📁 **Files** button that opens a full-screen explorer rooted at that terminal's project dir. A lazy directory tree + a **CodeMirror 6** editor (Markdown / JS-TS / JSON), a Markdown **Preview** toggle (sandboxed), and Save (⌘/Ctrl-S). Reads and writes are contained within the project root — `..`/absolute/symlink escapes are rejected.
- **tmux-backed session persistence** (#197): if `tmux` is installed, Claude sessions and launchers run inside a tmux session, so **a server crash or restart no longer kills your terminals** — the processes keep running and reattach when the server comes back. It uses its own isolated tmux server (never your personal tmux). **No tmux → non-persistent fallback**, exactly as before.
- **Settings modal overflow fix** (#196): the Settings modal now scrolls internally when tall (the Launch commands section had pushed it past the viewport).

Also: dependency bump to `@mulmoclaude/core@^0.8.1` / `@mulmoclaude/collection-plugin@^0.7.0` / `tsx@^4.23.0` (#186), and internal plan-file tidy-ups.

📦 **npm**: [`mulmoterminal@0.6.2`](https://www.npmjs.com/package/mulmoterminal/v/0.6.2) — `npx mulmoterminal@latest`

## mulmoterminal@0.6.1 — 2026-07-03

Patch release: the three grid features merged since `mulmoterminal@0.6.0`.

### Highlights
- **Agent state split** (#174): grid cells now distinguish **blocked** (waiting on a permission/question), **done** (finished a turn, output unreviewed), **working**, and **idle** — each with its own color (blocked = amber glow, done = blue glow, working = pulsing blue), and the auto-order is refined to `blocked > done > idle > working`.
- **Per-cell token usage badge** (#175): each cell's header shows its session's cumulative tokens (⇡ input incl. cache · ⇣ output), k/M-formatted with a breakdown tooltip, refreshed when a turn finishes.
- **Grid status summary** (#178): the toolbar shows an at-a-glance tally across all pages — how many cells are blocked (need input) / done (review) / working — so you can tell something needs you even when it's on an off-screen page.

### What's Changed
* docs: add docs/ChangeLog.md (mirror of the 0.6.0 release notes) by @isamu in https://github.com/receptron/mulmoterminal/pull/172
* feat: エージェント状態を blocked / done / working / idle に細分化 (#174) by @isamu in https://github.com/receptron/mulmoterminal/pull/176
* feat: セル別トークン使用量バッジ (#175) by @isamu in https://github.com/receptron/mulmoterminal/pull/177
* feat: グリッド状態サマリーをツールバーに表示 (#178) by @isamu in https://github.com/receptron/mulmoterminal/pull/179
* chore: bump version to 0.6.1 by @isamu in https://github.com/receptron/mulmoterminal/pull/180

**Full Changelog**: https://github.com/receptron/mulmoterminal/compare/mulmoterminal@0.6.0...mulmoterminal@0.6.1

## mulmoterminal@0.6.0 — 2026-07-02

This release lands 41 commits since `mulmoterminal@0.5.0`, focused on navigation, session/terminal persistence, the launcher, content browsing (collections + wiki), runtime translation, and a set of safety guards.

### Highlights

#### Navigation & terminal persistence
- **vue-router for top-level navigation** (#161): the app's top-level views are now driven by vue-router instead of ad-hoc local state, giving real routes for the single view, grid, collections, wiki, and accounting.
- **Terminals survive navigation** (#158): switching between views no longer tears down the PTY WebSocket — a terminal you leave keeps running and reattaches when you come back, instead of reconnecting from scratch.
- **Dynamic favicon** (#154): the browser tab favicon reflects live session state (a terminal `>_` mark that switches between working / needs-attention / idle), reconciled against the authoritative session list so it stays correct after prune/reconnect.

#### Launcher & working directories
- **Recent working directories in the launcher** (#155): an empty cell launcher remembers the directories you've started terminals in, so you can re-pick them quickly.
- **Auto-recorded directory presets** (#164, #163): launched directories are captured automatically as presets in most-recently-used order, and legacy `localStorage` recents are migrated forward. The manual "Directory presets" editor in Settings was removed in favor of this.

#### Collections, wiki & custom views
- **Collection registry import** (#157): a Discover tab wires the collection plugin host bindings — importing from a registry, listing feeds, and delete bindings for collection / feed / view.
- **Read-only Wiki browser** (#165): browse a wiki inside MulmoTerminal.
- **Custom-view write tier** (#167): `PUT /view-data` lets custom views persist data.
- Bump `@mulmoclaude/accounting-plugin` to 0.3.1 (#168).

#### Runtime translation
- **Translation service via a hidden chat** (#145, #150): `POST /api/translation` performs on-demand translation through a hidden Claude chat, and draft chat for collection starters was fixed alongside it.

#### Safety & UX guards
- **Confirm before closing the tab** (#149): closing or reloading the tab while a terminal is live pops the browser's native confirm dialog, so MulmoTerminal isn't closed by accident. It stays silent when nothing is running.
- **No false prompt on dev reloads** (#166): Vite HMR full-reloads are exempted from the close guard, so saving during development doesn't trigger the dialog.
- **Don't reap active chat sessions on switch-away** (#152): working/waiting sessions are kept alive when you switch away from them.
- **Hide grid sessions from the chat sidebar** (#169): multi-terminal grid sessions no longer clutter the single-view chat sidebar.

#### Server & housekeeping
- Move the GUI MCP endpoint under the `/api` prefix (#160).
- Archive completed plans into `plans/done/` (#151), docs updates (#159), and dependency refreshes (#147, #162, #170).

📦 **npm**: [`mulmoterminal@0.6.0`](https://www.npmjs.com/package/mulmoterminal/v/0.6.0)

### What's Changed
* feat: runtime translation service via hidden chat (POST /api/translation) by @snakajima in https://github.com/receptron/mulmoterminal/pull/145
* feat: activate translation + fix draft chat for collection starters by @snakajima in https://github.com/receptron/mulmoterminal/pull/150
* chore: archive 36 completed plans into plans/done/ by @snakajima in https://github.com/receptron/mulmoterminal/pull/151
* fix: don't reap working/waiting chat sessions on switch-away by @snakajima in https://github.com/receptron/mulmoterminal/pull/152
* feat: タブを閉じる/リロード前に確認ダイアログ（ターミナルがあるときのみ） by @isamu in https://github.com/receptron/mulmoterminal/pull/149
* update by @isamu in https://github.com/receptron/mulmoterminal/pull/147
* feat: 動的 favicon（ターミナル >_ マーク・状態で切替） by @isamu in https://github.com/receptron/mulmoterminal/pull/154
* feat: remember recent working directories in the cell launcher by @snakajima in https://github.com/receptron/mulmoterminal/pull/155
* feat: persist terminal connections across UI navigation by @snakajima in https://github.com/receptron/mulmoterminal/pull/158
* docs: update product-profiles plan for MulmoBooks decisions by @snakajima in https://github.com/receptron/mulmoterminal/pull/159
* refactor(server): move GUI MCP endpoint under /api prefix by @snakajima in https://github.com/receptron/mulmoterminal/pull/160
* feat: adopt vue-router for top-level navigation by @snakajima in https://github.com/receptron/mulmoterminal/pull/161
* update by @isamu in https://github.com/receptron/mulmoterminal/pull/162
* feat: wire collection plugin host bindings — registry import + feeds list + delete by @isamu in https://github.com/receptron/mulmoterminal/pull/157
* feat(wiki): read-only Wiki browser on MulmoTerminal by @snakajima in https://github.com/receptron/mulmoterminal/pull/165
* feat(unload-guard): skip the close confirm for Vite HMR reloads by @snakajima in https://github.com/receptron/mulmoterminal/pull/166
* Wire the custom-view write tier (PUT /view-data) by @snakajima in https://github.com/receptron/mulmoterminal/pull/167
* feat: 起動 dir を自動 preset 化し Settings の Directory presets を撤去 (#163) by @isamu in https://github.com/receptron/mulmoterminal/pull/164
* chore: upgrade @mulmoclaude/accounting-plugin to 0.3.1 by @snakajima in https://github.com/receptron/mulmoterminal/pull/168
* fix: hide multi-terminal grid sessions from the chat sidebar by @snakajima in https://github.com/receptron/mulmoterminal/pull/169
* update by @isamu in https://github.com/receptron/mulmoterminal/pull/170
* chore: bump version to 0.6.0 by @isamu in https://github.com/receptron/mulmoterminal/pull/171

**Full Changelog**: https://github.com/receptron/mulmoterminal/compare/mulmoterminal@0.5.0...mulmoterminal@0.6.0
