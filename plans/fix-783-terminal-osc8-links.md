# fix #783 — OSC 8 hyperlinks in terminal output are not clickable

## Problem

Links in terminal output (e.g. Claude Code's statusline `PR #2541`) are emitted as **OSC 8
hyperlinks** (arbitrary display text → URL). xterm 6.0's own docs:

> "The handler for OSC 8 hyperlinks. Links will use the `confirm` browser API with a strongly
> worded warning if no link handler is set."

MulmoTerminal never sets `linkHandler`, so clicking an OSC 8 link pops a `confirm()` warning
dialog instead of opening — which reads as "the link is broken". (WebLinksAddon and the #778
file-path provider have their own `activate` handlers and are unaffected — this is specific to
OSC 8 links.)

## Fix

Add a `linkHandler` to the xterm options (`useTerminalConnections.ts` `ensure()`), opening the
target in a new tab. Restricted to `http(s)://` — the safeguard xterm's docs call for, so a
program can't emit a `javascript:`/`file:` link that runs on click. The allowlist is a pure,
exported, unit-tested predicate (`isOpenableTerminalLink`).

## Verification

Automated: unit tests for `isOpenableTerminalLink` (http/https vs javascript:/file:/mailto:/…)
and that `ensure()` wires a `linkHandler` opening http(s) and ignoring others.

Interactive (human, on the real machine — canvas + hover/click can't be driven headlessly): in a
terminal, `printf '\033]8;;https://…/pull/780\033\\PR #780\033]8;;\033\\\n'`, then click `PR #780`
→ opens the PR in a new tab (no confirm dialog). Confirm a real file path (#778) and a plain URL
(WebLinks) still work.

## Scope

Only OSC 8 link activation. The separate terminal scroll/scrollbar/selection cluster is #782.
