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

## Filing issues
- Before filing a **bug / "broken" / "weird behaviour"** issue about MulmoTerminal, run the
  **`mulmoterminal-bug-report`** skill first: it checks whether the behaviour is actually
  config or by-design (reading the real config/schema/version), searches existing issues, and
  only files what survives — with env/repro masked.
- This gate is for bug reports. Pure feature requests / enhancements don't need it.
