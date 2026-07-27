# A preview of what each `.mulmoterminal.json` is actually doing

Issue: #950

## Why

Writing a directory config is covered — the `mulmoterminal-config` skill, and a Settings button
that launches it. Reading one back was not, anywhere in the UI.

That gap has a specific cost. Every way a setting can fail produces the SAME picture: nothing
happens. A colour that isn't `#rrggbb`, a size out of range, `badgeColour` for `badgeColor`, a key
that only exists in the global config — the loader drops each of them silently, exactly as if the
file had never mentioned it. From the outside, "I never set that" and "I set it and it didn't take"
are indistinguishable, and the only way to tell was to read the schema.

## What

Settings gains a **Directory settings** section: the recent directories, each expanding to

- the values in force, with a swatch beside every colour,
- the path of the file they came from,
- the keys the file set that were **dropped in validation**,
- the keys that are **not settings this app reads** — the typo case.

Read-only. Editing stays with the skill.

## Wire

A new `GET /api/dir-config-detail?cwd=`, rather than fields on `/api/dir-config`: every cell
fetches that one on mount, and this re-reads the file from disk to compare what was written
against what survived. It is wanted only while the modal is open, and only for a row the user
expands (a long history otherwise fires a read per row on open).

`describeDirConfig` (in `common/`, so the server computes it and the client types it) splits the
file's keys three ways against `DIR_CONFIG_KEYS`. A malformed file keeps its path in the answer:
"there is a file here and none of it applied" is the single most useful thing this can say, and
reporting no file would send the reader looking for one that is right there.

`DIR_CONFIG_KEYS` and the loader must not drift, so `dir-config.spec.ts` pins the list against
`Object.keys(loadDirConfig(...))` — a field added to the loader fails that test until it is
documented here too.

## Decisions taken without asking

- **Which directories are listed**: the recent-dir presets, plus the focused session's own
  directory when it isn't one of them. The alternative — scanning the disk for
  `.mulmoterminal.json` files — needs a directory to scan from and an answer for "how deep",
  neither of which has an obvious right answer.
- **Layout**: `<details>` rows in the existing modal, not a new tab. The modal is one scrolling
  column of sections; a tab bar would be a bigger change to it than this feature earns.
- **Sound** is reported as "configured", never as a path — the server deliberately keeps that path
  server-side (it is the confinement boundary for `sound`), and the preview does not widen it.

## Review follow-ups

**The list was empty on a real machine.** `useAppConfig()`'s `presets` is a PER-CALL ref, not one
of its module-level singletons, so the copy the settings modal read was a second, empty one — the
shell that ran `loadConfig` had the real list. It now comes down as a prop from each shell, with
the asymmetry called out where the refs are declared and a spec (`AppSettingsModal.spec.ts`)
pinning it.

**CodeRabbit: the preview couldn't show `provider` / `model` / `skills` / `addDirs` / buttons /
chips.** True — `PublicDirConfig` omits them (a running terminal has no use for them), so those
keys could be named as applied but never read back. `dirConfigDetail` now carries a separate
`extras` alongside the config. Buttons and chips contribute their LABELS only: a button's `cmd` is
what it would type into the session, which is neither part of "did my config take effect" nor
something a settings screenshot should carry.

**CodeRabbit: no per-value provenance (directory file vs global vs default).** Declined, with the
reasoning posted on the PR: this endpoint resolves ONE file and merges nothing, so every value it
returns is from the file whose path is printed above them. Per-key origin would only become
meaningful if the response started carrying merged values, which it deliberately doesn't. The UI
now says so in a line under the path, and a spec asserts a directory with no file reports nothing
rather than the app-wide settings.
