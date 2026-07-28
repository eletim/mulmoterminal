---
title: English
layout: default
nav_order: 3
has_children: true
description: A browser-terminal cockpit for running several AI coding agents (Claude Code, Codex) in parallel — the grid, the cockpit roster, git worktrees and phone push. Vibe coding, parallelised.
---

# MulmoTerminal Guide (English)

> 🆕 **[What's new in 2.5.1](v2.5.1.html)** — the Windows folder picker is the Explorer-style dialog, copying the last code block from a reply, and telling an issue you are working on it (as of 2026-07-28)
>
> **Something looks wrong?** Type `/mulmoterminal-bug-report` in any session. The bundled skill hears the symptom out, checks your **real** config and version to see whether it is configuration or by design, searches the existing issues — and only helps you file one if none of that explains it, with the environment collected and secrets masked.

**Run a whole team of AI coding agents (Claude Code / Codex) in parallel, on one board** —
MulmoTerminal is the cockpit for that — a browser terminal, so it doesn't care which editor you use.

**Vibe coding with one agent needs nothing but a shell.** What this app is for is the moment you run
**parallel agents** and lose track of which one is waiting on you. The vocabulary is in the
[glossary](glossary.html). The headline features first.

## Highlights

### The grid — a cockpit for parallel agents

![A board of parallel AI-agent terminals](../images/grid-2x2.png)

One independent agent per cell. **Status colors** (working = blue / awaiting input = amber /
done-review = blue ring) and an **attention sound** mean you pick up only the cells that call
you — no babysitting. → [Basics](basics.html)

### The cockpit roster — everyone's progress, one row each

![The cockpit roster — a summary list of every session beside one enlarged agent](../images/cockpit-roster.png)

Stay zoomed into one agent while a text list tracks **every session's AI summary, last
instruction, latest reply, and PR phase** (draft / CI fail / ready / merged …). This is the
main screen for running many agents. → [Basics](basics.html)

### Phone push & remote control — walk away, get called back

![Push notifications on a phone's lock screen](../images/push-lock-screen.jpg)

Finished and input-waiting turns send a **Web Push to your phone**; open the live screen there
and answer with one tap (**yes / no / continue**). → [Mobile notifications](notifications.html)

### Worktree isolation & one-click PRs

**Git worktrees** let several agents work the same repo without colliding — diff panel, commit,
push, and **Open PR**, all from the cell. → [Scenarios](scenarios.html)

### The GUI panel — a screen beside the terminal

The agent's tool calls render as **diagrams, forms, images, documents, and video/slides
(MulmoCast)**. Your agent hands you an interface, not just printed text. → [Feature reference](features.html)

### tmux persistence — sessions don't die

Sessions survive reloads, reconnects, and server restarts. Leave a long build running and come back.

---

## Vibe-coding with AI agents — sound familiar?

As you run more and more terminals and AI agents (**Claude Code** / **Codex**)…

- 📊 you **lose track of which one is doing what** (their status)
- 📁 you can't tell **which directory** each is in
- 💭 even when you know the dir, **what did I even ask it?** (you forget the instruction)
- an agent **finishes and you don't notice** — it waits on you, or you wait on it
- 💥 close the tab or the terminal drops, and **the session is gone**
- 🌿 you want to check git or open a folder, but keep **typing commands for it**
- all you really wanted was to **work fast with the terminal as your hub** —

AI agents take minutes per task. Babysit one and your hands sit idle; add more and keeping track gets harder.
The bottleneck isn't the CPU or the terminal — it's **your attention**.

## Every one of these, handled

| The moment | In MulmoTerminal |
|---|---|
| Can't tell the **status** of many terminals | Lay them out in a grid; **status colors** (working = blue / awaiting input = amber / done-review = blue ring) + a sound, at a glance (→ [Basics](basics.html)) |
| Don't know **which directory** | Each cell shows its dir, a **project name badge, and colors**. Color-code to tell them apart (→ [Config](config.html#per-dir)) |
| **Forget the instruction** | The cell header always shows the **latest instruction / what it's doing**; **Activity timeline** shows the **tool-call history** (→ [Feature reference](features.html)) |
| Want to **know it's done** | Input-waiting turns **amber**, a finished turn gets a **blue ring**, both **play a sound** — plus a **Web Push to your phone** (→ [Mobile notifications](notifications.html)) |
| Want the **session to survive** | **tmux persistence** keeps it alive across reload, reconnect, and server restart |
| Open **git / a dir** quickly | A git status chip; open **the OS file manager (Finder/Explorer) / the in-app files / a PR** in one click |
| Work with the **terminal as the hub** | All of the above on top of a terminal, and **extend it to your workflow with a DSL** (→ [Config](config.html#header)) |

## The four pillars behind it

1. **Supervise** — the grid is a **cockpit for parallel agents**. Triage by status color + sound; step in only where you're needed.
2. **See** — each agent's **status, model, context, git, tool-call timeline, and cost**, at a glance. What each one is doing and where, always visible.
3. **Automate & investigate** — run scripts in one click (in a **spare cell** next to a running session); when one fails, **turn a wall of logs into a short AI diagnosis**.
4. **Extend (DSL)** — header buttons/chips, launchers, and per-project config via **a small DSL** — it fits any developer.

## Get started

If the [`claude`](https://claude.com/claude-code) CLI (Claude Code) runs on your machine and you have **Node ≥ 22.9**,
one command starts it:

```bash
npx mulmoterminal@latest    # opens http://localhost:34567
```

### The CLIs it drives {#cli-tools}

MulmoTerminal is a cockpit over the tools you already develop with, so what you have on your
`PATH` decides how much of it lights up. `claude`, `git` and `gh` carry the core grid; each
remaining row unlocks one feature.

| | Tool | What it gives you | Install |
| --- | --- | --- | --- |
| **Required** | `claude` | every Claude session | `npm i -g @anthropic-ai/claude-code`, then run `claude` once to log in |
| **Required** | `git` | [worktree isolation](features.html), each cell's branch / unsaved-dot / diff readout, the PR footer | `brew install git` · `sudo apt install git` · Windows: [git-scm.com](https://git-scm.com/download/win) |
| **Required** | `gh` | the [cross-repo PRs & Issues view](github.html) and one-click PR creation | [cli.github.com](https://cli.github.com), then `gh auth login` |
| Recommended | `tmux` | [session persistence](features.html) — terminals survive a server restart | `brew install tmux` · `sudo apt install tmux` · no native Windows build (plain terminals instead) |
| Optional | `codex` | [Codex sessions](basics.html#claude-and-codex) in a cell, alongside Claude | `npm i -g @openai/codex` |
| Optional | `ffmpeg` | video rendering from the [GUI panel](features.html)'s mulmo-script plugin | `brew install ffmpeg` · `sudo apt install ffmpeg` |
| Optional | `ollama` | [claude-ollama](claude-ollama.html) — Claude Code against a fully local model | [ollama.com/download](https://ollama.com/download) |
| Optional | `docker` | the experimental Docker sandbox (single view; can't be combined with [OpenRouter](providers.html)) | [docs.docker.com](https://docs.docker.com/get-started/get-docker/) |

The server starts without the non-required ones — you only lose that row's feature. To see
what's missing on this machine, run **`npx mulmoterminal init`**: it reports every tool above,
then seeds the launcher's directory presets from your Claude Code history.

## How to read this guide

1. [Basics — what you can do in the grid](basics.html)
2. [Scenarios — workflows by example](scenarios.html)
3. [Feature reference](features.html) (grouped by the four pillars)
4. [Configuration](config.html) (settings modal · `config.json` · `.mulmoterminal.json` · the **DSL**)
5. [Mobile notifications (Web Push)](notifications.html) (iPhone / Android setup)
6. [From your phone](phone.html) (watch, reply with your own chips, start a terminal)
7. [GitHub — cross-repo PRs & Issues](github.html) (open PRs and issues from your registered repos on one screen)
8. [Using another model via OpenRouter](providers.html) (run Kimi / DeepSeek / Gemini, with measured data)
9. [Local models with claude-ollama](claude-ollama.html) (fully local, offline, via Ollama)

> The Japanese guide is here: [日本語ガイド](../ja/).
