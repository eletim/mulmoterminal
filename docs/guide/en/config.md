---
title: Configuration
layout: default
parent: English
nav_order: 4
---

# Configuration
{: .no_toc }

- TOC
{:toc}

Settings live in three places: the **settings modal (⚙)**, the **global config `~/.mulmoterminal/config.json`**, and the **per-project `<project>/.mulmoterminal.json`**. Buttons and chips are merged from both files.

{: .highlight }
> **You don't have to hand-write any of this.** Run **`/mulmoterminal-config`** in any MulmoTerminal
> session and the bundled skill walks you through it with checkboxes and colour presets, then writes
> a valid file — for the current directory or several of your recent ones at once. (The ⚙ →
> **🎨 Configure appearance…** button starts the same skill.)
>
> It is also how you find the settings that have **no UI at all** and exist only in
> `~/.mulmoterminal/config.json`: [`providers`](#providers) (another model),
> [`keymap`](#keymap) (keyboard shortcuts), [`terminalSubmit`](#terminal-submit) (the fix for
> "Shift+Enter submits instead of adding a line"), [`fontFamily`](#font-family) (the terminal
> font), and the periodic dev-work log. Hand-editing works
> too — this page documents every field — but the skill validates as it writes, which matters for
> `keymap`, where a malformed binding stops the server from starting.

---

## Settings modal (⚙)

Open it from the ⚙ in the toolbar.

![Settings modal](../images/settings.png)

| Item | Description |
|---|---|
| **THEME** | Midnight / Nord / Daylight / Solarized Light |
| **TERMINAL FONT SIZE** | The xterm font size in px (8–32). Applies to every terminal **in this browser** — a phone and a desktop each keep their own. A directory can override it with `fontSize` ([below](#per-dir)) |
| **DIRECTORY APPEARANCE** | "🎨 Configure appearance…" — set a directory's name badge, colors, and header interactively |
| **NOTIFICATION SOUND** | The sound played when a cell needs you (empty for the built-in chime, or any audio file) |
| **WEB PUSH NOTIFICATIONS** | The "Notify my devices when a task finishes" toggle (off by default → [Mobile notifications](notifications.html)) |
| **GOOGLE ACCOUNT** | Google sign-in for the Calendar link (not the RemoteHost Connect) |
| **PULL REQUEST REPOS** | The repos aggregated by the cross-repo PR/Issue view (`owner/repo`) |
| **LAUNCH COMMANDS** | Commands you can launch besides Claude in a grid cell (`{ label, command }`) |
| **MCP SERVERS** | Your own MCP servers to add to single-view sessions |
| **COST (ESTIMATED)** | Estimated cost readouts for Session / Today / Month |

## Global config `~/.mulmoterminal/config.json`

```json
{
  "cwdPresets": [
    { "label": "acme-web", "path": "/Users/you/projects/acme-web" },
    { "label": "acme-api", "path": "/Users/you/projects/acme-api" }
  ],
  "launchers": [
    { "label": "Shell", "command": "$SHELL" },
    { "label": "Node REPL", "command": "node" }
  ],
  "quickCommands": [
    { "label": "PR", "text": "PR作って", "agents": ["claude"] },
    { "label": "merge", "text": "mergeして" }
  ],
  "prRepos": ["acme/web", "acme/api"],
  "userMcpServers": [],
  "buttons": [],
  "chips": null
}
```

| Key | Role |
|---|---|
| `cwdPresets` | Working-directory chips in the launcher (`{ label, path }`; click to fill the field, ▶ to launch) |
| `launchers` | The launch commands that appear under "OR LAUNCH" in a grid cell |
| `quickCommands` | Phrases the **phone** offers as chips on a session (`{ label, text, agents? }`). Tapping one fills the input box — it is not sent until you press send. `agents` scopes a chip to `"claude"` / `"codex"` / `"shell"`; omit it to offer the chip everywhere. Editable in Settings → **Phone quick commands** |
| `prRepos` | The repos targeted by the cross-repo PR/Issue view |
| `buttons` / `chips` | Header buttons / chips (merged with project settings → [Customizing the header](#header)) |
| `providers` | Anthropic-compatible backends (→ [Using another model via OpenRouter](providers.html)) |
| `soundFile` | Custom notification sound (absolute path to an audio file; also settable from the modal) |
| `pushEnabled` | The Web Push master switch (default `false` → [Mobile notifications](notifications.html)) |
| `pushKinds` | Which moments push: `"finished"` (a turn ended) and/or `"waiting"` (the agent stopped to ask). Omit to keep both; `[]` for none (→ [Which moments push](notifications.html#kinds)) |
| `worklogEnabled` / `worklogIntervalHours` | The periodic dev-work log (default off / 6 hours) |
| `terminalSubmit` | Which bytes mean **submit** vs **newline** — `"cr"` (default) or `"esc-cr"` (→ [Enter — submit vs. newline](#terminal-submit)) |
| `keymap` | User-defined keyboard shortcuts. **Empty by default — nothing is bound** (→ [Keyboard shortcuts](#keymap)) |
| `fontFamily` | The font every terminal renders in — a CSS font-family stack (→ [Terminal font](#font-family)) |

## Running on another model (providers) {#providers}

Claude Code can talk to any Anthropic-compatible backend. The backend goes in `providers` in
`config.json`, the **key in the server's environment** (never in a config file), and the default model
in a project's `.mulmoterminal.json` — with a per-session override at launch.

```json
{
  "providers": [
    { "id": "openrouter", "label": "OpenRouter", "baseUrl": "https://openrouter.ai/api", "tokenEnv": "OPENROUTER_API_KEY", "maxOutputTokens": 16000 }
  ]
}
```

Note that `baseUrl` must not end in `/v1`, and `tokenEnv` is the **name** of a variable, not the key.

→ **Full walkthrough, the measured model list, how to add your own models, and troubleshooting:
[Using another model via OpenRouter](providers.html).**

## Terminal font (`fontFamily`) {#font-family}

The font every terminal renders in. There is **no Settings UI** — put a CSS font-family stack in
`~/.mulmoterminal/config.json`:

```json
{ "fontFamily": "'Cica', 'MS Gothic', monospace" }
```

Then **restart `mulmoterminal`** and reload the browser tab. The global config is read once at
server startup, so a hand-edit doesn't reach the browser until it restarts — the same caveat as
[`keymap`](#keymap) and [`terminalSubmit`](#terminal-submit), and the usual reason a new key looks
like it "didn't work". The **per-directory** key ([below](#per-dir)) is different: that file is
watched, so it applies the moment you save it.

Name the fonts **as your OS lists them**, most-wanted first, and the browser uses the first one that
is installed. Unset (the normal case) you get the built-in stack: **JetBrains Mono → Fira Code →
Menlo → Consolas**, followed by CJK faces for Japanese, Korean, and Chinese, ending in `monospace`.

A **directory** can pin its own with `fontFamily` in its `.mulmoterminal.json` ([below](#per-dir)),
which wins over this one. Unlike the font **size** — a display preference the Settings modal keeps
**per browser** — this is a single value for the whole host, because it names *fonts*, and which
fonts exist belongs to the machine rather than to the phone or laptop looking at it.

### Choosing a font for CJK

Pick one whose **fullwidth glyphs are exactly twice the width of its Latin ones**. The terminal
reserves exactly two columns for a fullwidth character, so a face that disagrees tears every
box-drawing frame — which is most of what an agent TUI draws. Fonts built for this include
**Cica**, **HackGen**, **Sarasa Mono J**, **Noto Sans Mono CJK JP**, **MS Gothic**, and
**BIZ UDGothic**.

### If it doesn't take

- **Nothing changed at all, for any font.** You probably haven't restarted the server. The global
  config is only read at startup — see above. (A per-directory `fontFamily` needs no restart.)
- **Nothing changed for one font.** It isn't installed under that exact name, so the browser skipped
  it and fell through to the next one. Check the spelling against your font book.
- **The whole value was ignored.** A stack is validated as one unit — if any entry is unusable, the
  whole thing is dropped and the built-in stack applies, rather than half of it taking effect.
  Characters CSS treats as syntax (`;` `{` `}` `(` `)` `<` `>` `\` `/` `@` `!`) are rejected, and
  quotes must be a matching pair around a whole name.
- **Everything went proportional.** That is the browser's default font, which means no name in the
  stack matched. MulmoTerminal appends `monospace` when you name no generic family, so this should
  only happen if you ended the stack with a proportional one yourself.

## Enter — submit vs. newline (`terminalSubmit`) {#terminal-submit}

Whether **Enter submits** your prompt or **inserts a newline** is decided by Claude Code (its
TUI), from the *bytes* the terminal sends it — not by MulmoTerminal. Two byte sequences are in
play:

- **CR** (`\r`) — what a bare **Enter** sends.
- **ESC + CR** (`\x1b\r`) — what **Option/Alt+Enter**, and MulmoTerminal's **Shift+Enter**, send.

Claude Code's **standard** binding reads **CR = submit** and **ESC+CR = newline**. That is
MulmoTerminal's default, so **you don't need this setting unless you have changed it**. Some people
rebind Claude Code the other way round (**CR = newline, ESC+CR = submit**); for them Shift+Enter
would *submit* the prompt, and the phone's "send" would only *type* the text without submitting it.
`terminalSubmit` makes both the keyboard and the phone follow your binding.

```jsonc
{ "terminalSubmit": "cr" }      // default: Enter submits, Shift+Enter makes a newline
{ "terminalSubmit": "esc-cr" }  // reversed: Enter submits with ESC+CR, Shift+Enter makes a newline
```

| Mode | Enter | Shift+Enter · Option/Alt+Enter | Phone "send" (remote view) |
|---|---|---|---|
| `cr` (default) | submit (`\r`) | newline (`\x1b\r`) | submits with `\r` |
| `esc-cr` | submit (`\x1b\r`) | newline (`\r`) | submits with `\x1b\r` |

In **both** modes the *meaning* is the same — **Enter submits, Shift/Option+Enter make a newline** —
only the bytes differ, so they match your Claude binding.

### Which one do I need?

Almost everyone wants the default (`cr`) — leave it unset. Choose `esc-cr` **only if, in
MulmoTerminal, Shift+Enter *submits* your prompt instead of adding a line** (equivalently: a bare
Enter drops to a new line instead of submitting). That is the tell-tale sign your Claude Code is on
the reversed binding. If you're unsure, keep `cr`; switch to `esc-cr` only if Shift+Enter misbehaves.

### How to set it

1. Open `~/.mulmoterminal/config.json` (create the file if it doesn't exist) and add the key at the
   top level — for the reversed binding:
   ```json
   { "terminalSubmit": "esc-cr" }
   ```
2. **Reload the browser tab** — the keyboard reads the value when the page loads.
3. **Restart `mulmoterminal`** — the phone remote-view "send" reads the value from the file at
   startup, so a hand-edit needs a restart to take effect there.
4. Verify: a bare **Enter** submits, and **Shift+Enter** drops to a new line.

An invalid value (a typo, or anything other than `"cr"` / `"esc-cr"`) is ignored and falls back to
`"cr"`, so a mistake never leaves Enter in a broken state.

### Notes

- **Claude sessions only** — `terminalSubmit` describes *Claude Code's* binding, so it only affects
  Claude cells. A **shell**, **codex**, or command cell always submits with a plain Enter (`\r`),
  even in `esc-cr` mode — a reversed setting never rewrites a shell's Enter.
- **Smartphones** — a soft keyboard can only send a bare **Enter** (there is no Shift+Enter, and on
  Android the Return key often isn't even a normal Enter). So on a phone Enter follows the table
  above and you can't insert a newline from the on-screen keyboard; compose multi-line prompts from
  the remote view's text box instead.
- **Japanese / other IME input** — while the IME is composing, **Enter confirms the candidate** and
  is never taken as submit or newline, in either mode. Your CJK input is unaffected.

## Keyboard shortcuts (`keymap`) {#keymap}

Keyboard shortcuts are **opt-in**. There are no defaults: with no `keymap` in `config.json`, nothing is
bound and no key is intercepted. That is deliberate — **every key you bind is a key the program inside the
terminal stops receiving**, and only you know whether that trade is worth it for your workflow.

```json
{
  "keymap": {
    "zoom-next": "PageDown",
    "zoom-prev": "Shift+PageUp"
  }
}
```

### Actions

| Action | What it does | Needs a zoomed cell |
|---|---|---|
| `zoom-toggle` | **Enlarge / collapse** — the only action that does. Enlarges the terminal the cursor is in, and collapsing leaves the cursor there | no |
| `zoom-next` | Move the enlargement to the **next** terminal in the on-screen order | yes |
| `zoom-prev` | Same, to the **previous** one | yes |
| `next-attention` | **Move to the next terminal worth looking at** — awaiting input first, then finished-and-unreviewed, then idle; cells mid-turn are skipped. Cycles. **Never enlarges or collapses**: zoomed it moves which terminal is enlarged, un-zoomed it moves the keyboard focus there (the focused cell lifts), switching page if needed | no |
| `terminal-new` | Add a terminal at the **end** (same as the toolbar's `New terminal ＋`) | no |
| `terminal-new-adjacent` | Add a terminal **right after the current one**, inheriting its working directory — the closest thing to "split this terminal" | yes |
| `terminal-close` | **Close** the current terminal (same as its `✕`) | yes |

Most actions need a terminal to act *on*, and the zoomed cell is the only one the grid can name — an
un-zoomed grid has no "current terminal", so those do nothing rather than guessing. **Bind at least one
of `zoom-toggle` / `next-attention`**: without a way in, every "needs a zoomed cell" action stays out of
reach until you click `⤢` with the mouse. The zoom moves **stop at
both ends** instead of wrapping. See [Basics → switching the enlarged terminal](basics.html#keyboard-zoom-switch).

{: .warning }
> **`terminal-close` closes immediately, with no confirmation** — the same as clicking the cell's `✕`, which
> ends that session. Bind it to something you won't hit by accident.

### Ready-made keymaps

Nothing is bound by default, so start from whichever of these matches the muscle memory you
already have and edit from there. Every key below is checked against the traps in
[Combinations that cannot be bound](#macos-keys).

**Minimal — just get into the zoom and back**

The two that matter most: without one of these, every "needs a zoomed cell" action is out of
reach until you click `⤢`.

```json
{ "keymap": { "zoom-toggle": "F8", "next-attention": "F9" } }
```

**tmux-flavoured** — if `Ctrl`+`B` is already in your fingers, note that binding it here takes it
away from tmux itself. These use `Alt` instead, which tmux leaves alone.

```json
{
  "keymap": {
    "zoom-toggle": "Alt+z",
    "zoom-next": "Alt+n",
    "zoom-prev": "Alt+p",
    "next-attention": "Alt+a",
    "terminal-new": "Alt+c",
    "terminal-close": "Alt+x"
  }
}
```

{: .warning }
> On **macOS** `Alt`+letter does not work — `Option` types an alternate character, so the letter
> never arrives (see [above](#macos-keys)). Mac users want the arrows version below.

**iTerm2-flavoured** — closest to `Cmd`+`D` splitting a pane. `terminal-new-adjacent` opens the
new terminal next to the current one, inheriting its directory, which is the nearest thing the
grid has to a split.

```json
{
  "keymap": {
    "zoom-toggle": "Cmd+Enter",
    "zoom-next": "Cmd+]",
    "zoom-prev": "Cmd+[",
    "next-attention": "Cmd+Shift+A",
    "terminal-new-adjacent": "Cmd+d"
  }
}
```

{: .note }
> `Cmd`+`W` is **not** here on purpose — the browser reserves it, so a close binding cannot use it.
> `Cmd`+`Shift`+`W` works if you want one.

**Arrow keys — the safest cross-platform set.** Arrows are unaffected by the macOS `Option`
problem and are not browser-reserved, so this one behaves the same everywhere.

```json
{
  "keymap": {
    "zoom-toggle": "Alt+ArrowUp",
    "zoom-next": "Alt+ArrowRight",
    "zoom-prev": "Alt+ArrowLeft",
    "next-attention": "Alt+ArrowDown",
    "terminal-new-adjacent": "Alt+Shift+ArrowRight"
  }
}
```

**Supervising many agents** — one key, pressed repeatedly, to walk everything that wants you:
awaiting input first, then finished-and-unreviewed, then idle, skipping whatever is mid-turn.

```json
{ "keymap": { "next-attention": "F9", "zoom-toggle": "F8" } }
```

### Binding syntax

`Modifier+Modifier+Key`. The key is matched against the browser's `KeyboardEvent.key` value.

- **Modifiers**: `Shift`, `Ctrl` (`Control`), `Alt` (`Option`), `Cmd` (`Command`, `Meta`). Case-insensitive.
- **Key**: exactly as the browser reports it — `PageDown`, `Home`, `F5`, `ArrowUp`, `a`. Printable letters
  are **case-sensitive** (`A` implies Shift is held).
- **Modifiers match exactly.** Binding `PageDown` does *not* fire for `Shift+PageDown`; that keystroke stays
  with the terminal. This is how you keep `Shift`+`Page Up`/`Page Down` for xterm's scrollback.
- A malformed binding (unknown modifier, a lone `Shift`, a trailing `+`) makes MulmoTerminal **refuse to
  start**, printing the offending line. A silently-ignored typo is indistinguishable from "the shortcut just
  doesn't work", which would send you hunting in the app for a one-character problem in a file.
- **Two actions on the same keystroke** only ever fires the first, so MulmoTerminal **warns** at startup
  naming both. Comparison is on the parsed keystroke, so `Shift+PageUp` and `shift+PageUp` count as the same.
- An IME composition always passes through, so Japanese/CJK candidate selection is never intercepted.
- **On a Mac, function keys and `Option`+letter need care** — see [below](#macos-keys) before picking either.

### Combinations that cannot be bound

MulmoTerminal runs in a browser tab, and some keys never reach a web page in a form it can suppress.

| Combination | Why |
|---|---|
| `Cmd`/`Ctrl`+`W`, `Cmd`/`Ctrl`+`T`, `Cmd`/`Ctrl`+`N`, `Cmd`/`Ctrl`+`Shift`+`T` | **Reserved by the browser** (close/new tab, new window). A page cannot intercept them — binding one simply does nothing |
| `Ctrl`+`Cmd`+`D` and similar on macOS | The **OS** may consume it first (this one opens Dictionary), so it may never reach the browser at all. Depends on your system settings |
| `Ctrl`+`C` / `Ctrl`+`D` / `Ctrl`+`B` etc. | These *can* be bound, but they are what the shell, `readline` and `tmux` use. Binding one takes it away from the terminal — allowed, but rarely what you want |

### On a Mac, watch out for the function keys {#macos-keys}

**`F1`–`F12` do not reach the browser by default.** Apple documents that ["by default, keyboard
function keys are set up to control system features"](https://support.apple.com/guide/mac-help/use-keyboard-function-keys-mchlp2596/mac)
— brightness, volume and so on. While that is in effect, pressing `F2` never delivers a keydown to
the page at all, so a binding on it looks completely dead and nothing in MulmoTerminal can observe
it. Two ways out, both from Apple's guide:

- Hold **`Fn`** (or the **Globe** key) while pressing the key. A binding of `"F2"` matches that —
  `Fn` is not a modifier the browser reports, so it needs no spelling in the binding. *(Verified on
  macOS: `Fn`+`F2` fires a binding written as `"F2"`.)*
- Or turn the default off: **System Settings → Keyboard → Keyboard Shortcuts → Function Keys →
  "Use F1, F2, etc. keys as standard function keys"**. The bare key then works, and `Fn` gives you
  the system feature instead. (Apple's [step-by-step article](https://support.apple.com/en-us/102439)
  covers older macOS versions, where the setting sits in System Preferences → Keyboard.)

Which system feature each key controls depends on the keyboard and macOS version, and Apple
publishes no fixed per-key table — so if one key stays dead after the change, assume the system
still owns it and pick another. The console check below tells you which case you are in.

**`Option`+letter is a poor choice on macOS.** Bindings are matched against `KeyboardEvent.key`,
which per [MDN](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key) reports *the
character the keystroke would actually input*, after the modifiers and keyboard layout are applied
— and it is the literal string `"Dead"` for a dead key. Since macOS uses `Option` to type alternate
characters and accents, `Option`+letter generally arrives as that character rather than the letter,
so a binding like `"Alt+n"` will not match. Prefer `Option` with a **non-printing** key
(`Alt+ArrowDown`, `Alt+PageUp`), which is unaffected. Check your own layout with the snippet below
before committing to one.

{: .note }
> Not sure what a key actually sends? Paste this in the browser devtools console and press it. **If
> nothing is logged, the OS or the keyboard took it before the page** — no binding can help. If it
> logs something other than what you wrote in `keymap`, bind what it actually reports.
>
> ```js
> addEventListener("keydown", e => console.log(e.key, e.code, {shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey}), true);
> ```
{: .note }
> An **unknown action name only warns** and the app still starts — that is what a config written for a newer
> MulmoTerminal looks like, and downgrading must not brick it. Further actions (reordering, page switching,
> navigation) are tracked in [issue #829](https://github.com/receptron/mulmoterminal/issues/829).

## Per-project `.mulmoterminal.json` {#per-dir}

Place this at the project root to change the appearance, sound, and header of **terminals (grid cells) opened in that directory**.

### Which model to use

```json
{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k2.7-code"
}
```

The backend and model this directory's sessions start on. Omit `provider` and give only `model` to
pick a different model on Anthropic itself. → [Using another model via OpenRouter](providers.html)

### Name badge and colors

```json
{
  "name": "acme-web",
  "badgeColor": "#2563eb",
  "headerColor": "#0b2545",
  "headerTextColor": "#e6f0ff",
  "cellColor": "#0e1117",
  "cellBorderColor": "#1f6f4f",
  "dotColor": "#22c55e",
  "buttonColor": "#a7f3d0"
}
```

All values are `#rrggbb`. The working / needs-you status colors take priority over these background colors (which show when idle).

### The terminal itself (xterm palette)

Where `headerColor` and friends tint the **chrome** (header / cell frame), **`colors` (and `theme`) tint the terminal
itself (xterm)**. `colors` overrides xterm's ITheme — `background` / `foreground` / `cursor` and the 16 ANSI colors
(`red`, `green`, …).

```json
{
  "name": "🌌 van-gogh",
  "headerColor": "#0b1a4a",
  "headerTextColor": "#f2e29b",
  "colors": { "background": "#0a1330", "foreground": "#f2e29b", "cursor": "#f5b301" }
}
```

Set `theme` to `midnight` / `nord` / `daylight` / `solarized` for a preset palette; `colors` layers per-key
overrides on top. The color-coding screenshot in [Scenario 6](scenarios.html) combines header colors with `colors` to
paint each project — **from the header down to the terminal body**.

### Terminal font size (`fontSize`)

`fontSize` sets the px size of the terminal font for this directory, overriding the Settings value:

```json
{ "fontSize": 16 }
```

Valid range is **8–32**. A size outside it is clamped to the nearest end (so `99` becomes 32 rather than
being ignored); a non-number is ignored and the Settings value applies.

Use this rather than the browser's zoom (Ctrl +/−). Zoom scales the page without telling the terminal, so
xterm's character grid stops matching what the shell believes the window to be, and the cursor and line
wraps drift. Setting `fontSize` re-fits the terminal and sends the new width/height to the process, so
everything stays aligned.

### Terminal font (`fontFamily`)

`fontFamily` pins the font stack for this directory's terminals, overriding the global
[`fontFamily`](#font-family):

```json
{ "fontFamily": "'Cica', 'MS Gothic', monospace" }
```

Same rules as the global key — see [Terminal font](#font-family) for how to choose one, what happens
to an invalid stack, and why a CJK face has to be em-square. Handy for a repo whose logs are full of
Japanese while the rest of your work is ASCII.

Unlike the global key, this one needs **no restart**: `.mulmoterminal.json` is watched, so the
terminals in that directory re-fit to the new font the moment you save.

### Customizing the header (buttons / chips) {#header}

This is where MulmoTerminal's **Extend** pillar lives. Shape the header of a running terminal to fit your workflow with **a small DSL**.
Any developer can turn their frequent actions into a single click and surface only the information they want to see — that's what this is for.

**Buttons** (`buttons`) — action buttons that act on a running session. Display is an `emoji` or an `icon` (a Material Symbol name) plus a `label`; `order` controls the sort.
With none set, you get a **built-in starter set**: 📎 insert a file path · 📂 reveal in the file manager · 📁 browse files in the app · 🖥 new terminal here · 🔗 this branch's PR (git repos, only when a PR exists) · 🌐 open on GitHub (git repos). Setting `buttons` at any level **replaces the whole default set** (it is _not_ merged on top) — so listing your own, even a **shorter** list, is how you trim, reorder, or swap them.

```json
{
  "buttons": [
    { "id": "compact", "emoji": "🗜️", "label": "Compact", "run": "input", "text": "/compact", "when": "agent == claude" },
    { "id": "gh",      "emoji": "🌐", "label": "Open on GitHub", "run": "open", "open": { "url": "https://github.com/${repo}" }, "when": "isGitRepo" },
    { "id": "reveal",  "emoji": "📁", "label": "Reveal folder", "run": "open", "open": { "reveal": "${dir}" } },
    { "id": "build",   "emoji": "🔨", "label": "Build", "run": "shell", "cmd": "yarn build" }
  ]
}
```

- `run: "input"` … send `text` to the running Claude/Codex (e.g. `/compact`).
- `run: "open"` … `url` (browser, http/https only) / `reveal` (OS file manager: Finder/Explorer/xdg-open) / `files` (in-app explorer) / `pickFile` (OS file dialog, inserts the path) / `terminal` (a new terminal cell in that directory) / `pr` (the current branch's PR in the browser) / `view` (`diff`/`prs`/`wiki`/`collections`/`accounting`).
- `run: "shell"` … run `cmd` in a command cell (the id is resolved server-side, `${variables}` are shell-escaped, and the command never reaches the browser).
- `${variables}` … `dir` `dirName` `branch` `repo` `remoteUrl` `ahead` `behind` `dirty` `agent` `model` `task` `session`.
- `when` … `isGitRepo` / `agent == …` / `repo == …` (`&&` / `||`, with `&&` taking precedence).

**Chips** (`chips`) — reorder / hide the info chips in a grid cell header, plus custom ones. `null` (the default) behaves as before.

```json
{ "chips": ["ctx", "git", { "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }] }
```

- Built-in `dir` / `git` / `diff` / `ctx` / `usage` / `status` / `tools` … shown in the order you list them; omit one to hide it.
- Custom `{ label, text, when }` … read-only text (`text` expands `${variables}`).

### ⚡ Skill menu filter (`skills`)

The header's **⚡ Skill ▾** lists the skills available in that directory
(`<project>/.claude/skills` and `~/.claude/skills`). Working-dir (project) skills come
first, then user-scope ones. Picking one runs the skill **in the current session**
(Claude: `/<slug>`; Codex: `Use the "<slug>" skill.`).

Set `skills` to an allowlist to show **only those slugs, in that order**. **Omit it to
show everything.**

```json
{ "skills": ["review-diff", "commit-msg"] }
```

- Skill names (slugs) must start alphanumeric and contain only `a-z 0-9 - _`; a slug that doesn't resolve is ignored.

## Scripts `<project>/script.json`

Your project's scripts that can run in a grid cell (dev server, tests, build, and so on).

```json
{ "scripts": [ { "label": "dev", "command": "yarn dev" }, { "label": "test", "command": "yarn test", "cwd": "." } ] }
```

## Environment variables

| Variable | Default | Role |
|---|---|---|
| `CLAUDE_CWD` / `--cwd` | The directory you run `npx mulmoterminal` in (only `~/mulmoclaude` when the server is started directly) | The default working directory (the PTY's cwd); also set via `--cwd` |
| `PORT` | `34567` | The server port |
| `MULMOTERMINAL_HOST` | `127.0.0.1` | The interface the server binds to (→ [below](#bind-host)) |
| `MULMOTERMINAL_HOME` | `~/.mulmoterminal` | The root for managed git worktrees |

### Who can reach the server (`MULMOTERMINAL_HOST`) {#bind-host}

The server binds to **loopback only**, so it answers this machine and nothing else. That is the
right default because **MulmoTerminal has no login of its own**: anything that can open a socket
to it can read your sessions, browse files under a session's directory, and start terminals.

Set `MULMOTERMINAL_HOST` to widen that deliberately — `0.0.0.0` for every interface, or one
address. `localhost` is accepted and normally resolves to loopback — though a hosts file can
point it elsewhere, which is why the warning below is based on **what the server actually bound**
(`server.address()`) rather than on what you typed. It prints at startup whenever that is not
loopback, because there is no other signal that it happened.

```bash
MULMOTERMINAL_HOST=0.0.0.0 npx mulmoterminal   # trusted networks only — see the caveat below
```

**This is for port-forwarding, not for browsing from another machine.** The same-origin checks
that protect the terminal WebSockets accept only a *localhost* origin, so a browser opening
`http://<this-machine>:34567` from elsewhere on the network loads the page and then fails to
attach a terminal. Where the opt-in does help is when something forwards a local port to the
server — a **Docker container** or **WSL**, where the process must bind `0.0.0.0` inside for the
mapping to reach it while the browser still connects to `localhost` on the outside.

You do **not** need this to use MulmoTerminal from your phone: the phone companion talks to the
host over Firestore, not over your local network (→ [from your phone](phone.html)).

---

← [Back to the feature reference](features.html) / [Guide contents](index.html)
