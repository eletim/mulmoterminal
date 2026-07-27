// Per-directory overrides read from <cwd>/.mulmoterminal.json: a terminal opened in
// a directory can carry its own xterm palette, a badge label/color, and an attention
// sound. Every field is optional; a missing or malformed file yields all-null so the
// terminal falls back to the global theme/sound. Field validation lives in the zod
// schemas of config-schema.ts; the path-confinement check for `sound` (the security
// surface) stays here because it touches the filesystem.
import { existsSync, statSync, realpathSync } from "node:fs";
import path from "node:path";
import { sanitizeButtons, sanitizeChips } from "./header-config.js";
import { EMPTY_DIR_CHROME, type DirChrome } from "../../common/dirChrome.js";
import { isWithin } from "../infra/path-within.js";
import { readJsonFile } from "../infra/read-text-file.js";
import { isRecord } from "../../common/isRecord.js";
import { NOTIFY_KINDS, type NotifyKind } from "../../common/notifyKinds.js";
import { parsePresetRef } from "../../common/notifySounds.js";
import {
  dirNameField,
  dirColorField,
  dirThemeField,
  dirColorsField,
  dirFontSizeField,
  dirFontFamilyField,
  dirSkillsField,
  dirProviderField,
  dirModelField,
  type ThemeId,
  type HeaderButton,
  type HeaderChip,
} from "./config-schema.js";

const DIR_CONFIG_FILE = ".mulmoterminal.json";

export interface DirConfig extends DirChrome {
  theme: ThemeId | null;
  // Per-key xterm palette overrides (on top of `theme`), or null when none are valid.
  colors: Record<string, string> | null;
  // Absolute path to the attention sound, resolved within cwd; null when unset or the
  // configured path is absolute / escapes the directory / doesn't exist. The fallback for
  // EVERY notification kind; `sounds` overrides it per kind.
  sound: string | null;
  // Per-kind overrides of `sound` (#873), each either a preset or a file inside cwd.
  sounds: Partial<Record<NotifyKind, DirSound>>;
  // Per-project terminal-header action buttons (merged over the global ones by id).
  // null = this dir doesn't configure buttons.
  buttons: HeaderButton[] | null;
  // Per-project header display chips, or null when this dir doesn't configure them.
  chips: HeaderChip[] | null;
  // Header Skill-menu allowlist: show only these skill slugs, in this order. null =
  // this dir doesn't filter, so the menu shows every discovered skill.
  skills: string[] | null;
  // Which backend/model this directory's sessions run on (#579). Never a secret.
  provider: string | null;
  model: string | null;
}

// What the browser receives: the raw sound path stays server-side (streamed via
// /api/dir-sound), so the client only learns whether one exists.
//
// Listed rather than derived from DirConfig, so the wire shape reads in one place
// instead of as "the server type minus four names" — a reader can see what leaves
// the server without also holding DirConfig in their head.
export interface PublicDirConfig extends DirChrome {
  theme: ThemeId | null;
  colors: Record<string, string> | null;
  hasSound: boolean;
}

// Claude's tool hooks already report every write, so they double as the live-reload signal — no
// filesystem watchers (cwds are scattered, so a watcher can't be shared across terminals).
const WRITE_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit"]);

/** The directory whose `.mulmoterminal.json` a tool call just wrote, or null for anything else.
 *  A relative `file_path` is relative to the SESSION's cwd, never the server process's — resolving
 *  it against `process.cwd()` would invalidate a directory nobody is looking at AND miss the real
 *  one, so without a known session cwd we publish nothing. */
export function dirConfigWriteTarget(toolName: unknown, toolInput: unknown, sessionCwd: string | null = null): string | null {
  if (typeof toolName !== "string" || !WRITE_TOOLS.has(toolName)) return null;
  if (!isRecord(toolInput) || typeof toolInput.file_path !== "string") return null;
  const file = toolInput.file_path;
  if (path.basename(file) !== DIR_CONFIG_FILE) return null;
  if (path.isAbsolute(file)) return path.dirname(path.resolve(file));
  return sessionCwd ? path.dirname(path.resolve(sessionCwd, file)) : null;
}

// A directory's sound for one notification kind: its own audio file, or one of the built-in
// presets. The preset arm carries no path — the id is matched against a fixed catalog — so a
// project can pick a sound without shipping an mp3 and without widening what it can read.
export type DirSound = { source: "file"; path: string } | { source: "preset"; id: string };

// One `sounds` entry: a `preset:<id>` reference, else a file confined to cwd by resolveDirSound.
export function resolveDirSoundValue(cwd: string, input: unknown): DirSound | null {
  if (typeof input !== "string") return null;
  const presetId = parsePresetRef(input.trim());
  if (presetId) return { source: "preset", id: presetId };
  const file = resolveDirSound(cwd, input);
  return file ? { source: "file", path: file } : null;
}

function resolveDirSounds(cwd: string, input: unknown): Partial<Record<NotifyKind, DirSound>> {
  if (!isRecord(input)) return {};
  const out: Partial<Record<NotifyKind, DirSound>> = {};
  NOTIFY_KINDS.forEach((kind) => {
    const resolved = resolveDirSoundValue(cwd, input[kind]);
    if (resolved) out[kind] = resolved;
  });
  return out;
}

// Confine the configured sound to a real file INSIDE cwd. Relative paths only;
// anything absolute or escaping via "../" is rejected so an opened project can't
// point the player at arbitrary files on disk. The lexical check only constrains the
// path string, so we ALSO canonicalize with realpath and re-check — otherwise a file
// inside cwd that is a symlink to a target outside it would slip through.
export function resolveDirSound(cwd: string, input: unknown): string | null {
  if (typeof input !== "string") return null;
  const rel = input.trim();
  if (!rel || path.isAbsolute(rel)) return null;
  const base = path.resolve(cwd);
  const resolved = path.resolve(base, rel);
  if (!isWithin(base, resolved)) return null;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return null;
  try {
    if (!isWithin(realpathSync(base), realpathSync(resolved))) return null;
  } catch {
    return null;
  }
  return resolved;
}

const EMPTY: DirConfig = {
  ...EMPTY_DIR_CHROME,
  theme: null,
  colors: null,
  sound: null,
  sounds: {},
  buttons: null,
  chips: null,
  skills: null,
  provider: null,
  model: null,
};

export function loadDirConfig(cwd: string): DirConfig {
  try {
    const base = path.resolve(cwd);
    const file = path.join(base, DIR_CONFIG_FILE);
    if (!existsSync(file)) return EMPTY;
    const raw: unknown = readJsonFile(file);
    if (!isRecord(raw)) return EMPTY;
    return {
      name: dirNameField.parse(raw.name),
      badgeColor: dirColorField.parse(raw.badgeColor),
      headerColor: dirColorField.parse(raw.headerColor),
      headerTextColor: dirColorField.parse(raw.headerTextColor),
      cellColor: dirColorField.parse(raw.cellColor),
      cellBorderColor: dirColorField.parse(raw.cellBorderColor),
      dotColor: dirColorField.parse(raw.dotColor),
      buttonColor: dirColorField.parse(raw.buttonColor),
      fontSize: dirFontSizeField.parse(raw.fontSize),
      fontFamily: dirFontFamilyField.parse(raw.fontFamily),
      theme: dirThemeField.parse(raw.theme),
      colors: dirColorsField.parse(raw.colors),
      sound: resolveDirSound(base, raw.sound),
      sounds: resolveDirSounds(base, raw.sounds),
      buttons: sanitizeButtons(raw.buttons),
      chips: sanitizeChips(raw.chips),
      skills: dirSkillsField.parse(raw.skills),
      provider: dirProviderField.parse(raw.provider),
      model: dirModelField.parse(raw.model),
    };
  } catch {
    return EMPTY;
  }
}

export function publicDirConfig(cwd: string): PublicDirConfig {
  const {
    name,
    badgeColor,
    headerColor,
    headerTextColor,
    cellColor,
    cellBorderColor,
    dotColor,
    buttonColor,
    fontSize,
    fontFamily,
    theme,
    colors,
    sound,
    sounds,
  } = loadDirConfig(cwd);
  return {
    name,
    badgeColor,
    headerColor,
    headerTextColor,
    cellColor,
    cellBorderColor,
    dotColor,
    buttonColor,
    fontSize,
    fontFamily,
    theme,
    colors,
    hasSound: sound !== null || Object.keys(sounds).length > 0,
  };
}

// The sound this directory wants for one kind: its per-kind entry, else its all-kind
// `sound`. Null when the directory configures neither — the caller then falls back to the
// user's global sound and finally to the built-in chime.
export function dirSoundFor(cwd: string, kind: NotifyKind | null): DirSound | null {
  const config = loadDirConfig(cwd);
  const perKind = kind ? config.sounds[kind] : undefined;
  if (perKind) return perKind;
  return config.sound ? { source: "file", path: config.sound } : null;
}
