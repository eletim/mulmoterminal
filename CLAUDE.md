# CLAUDE.md — mulmoterminal

Working notes for AI coding agents in this repo. Human-facing docs (what it is,
install, features, full API/architecture) live in **README.md** — read it for
anything not covered here.

## Stack & package manager
- TypeScript. Web UI: **Vue 3 (Composition API)** + Vite (`src/`). Backend:
  **Express** + **node-pty**, run via **tsx** (`server/`). Shared code in `common/`.
- Package manager: **yarn** (yarn.lock). Use `yarn add`; don't hand-edit package.json.

## Run after changes
- `yarn format` — Prettier. `.prettierignore` excludes `*.md`, so Markdown is not reformatted.
- `yarn lint` — ESLint.
- `yarn typecheck` — `vue-tsc -b`. **App code only — it does NOT compile the specs.**
- `yarn typecheck:server` / `yarn typecheck:test` — CI runs these too. `typecheck:test`
  (`tsconfig.test.json` + `tsconfig.test-server.json`) is the one that type-checks the specs,
  including the ones colocated under `server/` rather than in `test/`. Change a shared type or
  a wire shape and run **all three**: `yarn typecheck` alone passes while CI fails.
- `yarn build` — `vue-tsc -b && vite build`.
- `yarn test` — **Vitest** (`test/**/*.spec.ts`). Mock external APIs; tests must run without API keys.
- `yarn dev` — server + Vite together (local development).

## Layout
- `server/` — backend (PTY sessions, config, agents, backends). Ships user-facing skills in `server/skills/`.
- `src/` — Vue web UI (App.vue, components, composables, router).
- `common/` — code shared by server and UI. **Both** `tsconfig.server.json` and
  `tsconfig.app.json` include it, so a value or wire type that BOTH sides decide from
  (a shared config, an `/api/*` response shape, an enum) belongs here — never mirrored
  into `server/` and `src/` with a "keep the two copies in sync" comment. When the two
  sides genuinely differ, share the common core and keep each side's extras local, with
  a test pinning the asymmetry (see `common/sourceExtensions.ts` + its spec).
- `bin/` — CLI entry (`npx mulmoterminal`, `claude-ollama`, …).
- `docs/` — Jekyll site; bilingual guide under `docs/guide/{en,ja}` (keep both in sync).
- `plans/` — design notes per change. `test/` — Vitest specs.

## Bundled skills
`server/skills/` ships skills to end users (mulmoterminal-config, mulmoterminal-bug-report);
they are mirrored to `~/.claude/skills/`.

## Publishing a release

`/publish` drives the mechanics (bump, tag, npm, GitHub release). Two things are this repo's
own, and both are easy to skip because the release still "works" without them:

**1. `docs/ChangeLog.md`** — English, newest-first, the same per-PR detail as the GitHub release.
It records **what changed and why**.

**2. A dated setup guide, `docs/guide/{en,ja}/v<version>.md`** — for the person who wants a new
feature **the day it ships**. The changelog explains what changed; it does not tell anyone how to
turn a thing on, and for something like `keymap` there is otherwise nowhere to look. Write the
procedure: open this file, paste this, restart what, how to tell it worked, what breaks on a Mac.

- **Both languages**, and `nav_order` must be a **unique** sequence running **newest release
  first** — ordered by release date, not by version number sorted as text, so 1.11.1 sits above
  1.11.0. A new release takes the lowest free number and everything below shifts down by one.
  When renumbering, **enumerate `docs/guide/*/v*.md` rather than typing the list out**: a
  hand-typed list has silently dropped a page, and the check written from the same list agreed
  with it, so nothing caught the duplicate until review did.
- **State the date in the first line and call it a snapshot.** These pages *will* go stale — that
  is accepted, and the date is what makes a stale one readable rather than misleading. Never
  edit an old one to match new behaviour; write the next version's page instead.
- **Link out to the living guide from every section.** The dated page holds the procedure, the
  guide holds the reference — do not duplicate the reference.
- A fix-only release still gets a page: "nothing to configure", what was broken, and **how to
  tell you have the fix**. That is what an upgrader actually wants to know.
- **Link it from the changelog entry** (a `> 📘` line right under the heading). Before this
  existed the changelog had one link into the guide in 717 lines, which is why nobody found the
  manual.
- **Verify before committing**: every internal link resolves to a real page *and anchor*, and any
  config sample is run through its real validator — a bad `keymap` sample stops a reader's server
  from starting.

## Filing issues
- Before filing a **bug / "broken" / "weird behaviour"** issue about MulmoTerminal, run the
  **`mulmoterminal-bug-report`** skill first: it checks whether the behaviour is actually
  config or by-design (reading the real config/schema/version), searches existing issues, and
  only files what survives — with env/repro masked.
- This gate is for bug reports. Pure feature requests / enhancements don't need it.
