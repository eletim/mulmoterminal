// Install the skills we ship into the user's global skills roots on boot, so each is callable from
// ANY launched terminal (`/mulmoterminal-config`, `/mulmoterminal-bug-report`) regardless of cwd —
// including under `npx`, since they ship in the package. Modeled on server/codex-skills.ts: an
// ownership marker means we only ever refresh OUR copy and never clobber a user's own same-named
// skill. Best-effort: a filesystem failure logs and continues, never aborting server startup.
import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { codexSkillsRoot } from "../agents/codex-skills.js";
import { dirConfigJsonSchema } from "../config/config-schema.js";

const OWNER_MARKER = ".mt-owned";
const OWNER_MARKER_BODY = "managed by mulmoterminal\n";
// The generated JSON Schema shipped alongside SKILL.md. Must NOT be `schema.json` — that exact
// name makes the collections engine load the skill dir as a (broken) user-scope collection.
export const SCHEMA_ASSET_FILE = "dir-config.schema.json";

export const BUNDLED_SKILL_NAMES = ["mulmoterminal-config", "mulmoterminal-bug-report"] as const;

function bundledSkillDir(name: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // ".." climbs server/infra/ → server/, where the bundled skills/ dir lives.
  return path.join(here, "..", "skills", name);
}

const isOurs = (dir: string): boolean => existsSync(path.join(dir, OWNER_MARKER));

// Copy `sourceDir` into `<destParent>/<name>`, refreshing our own copy so shipped edits/removals
// propagate, but SKIPPING a same-named directory we don't own (no marker) so a user's hand-written
// skill is never clobbered. `extras` are additional files written into the destination after the
// copy (e.g. a generated schema.json). Returns what happened, for logging/tests.
export function installOwnedSkill(sourceDir: string, destParent: string, extras: Record<string, string> = {}): "installed" | "skipped" | "absent-source" {
  if (!existsSync(sourceDir)) return "absent-source";
  const dest = path.join(destParent, path.basename(sourceDir));
  if (existsSync(dest) && !isOurs(dest)) return "skipped";
  rmSync(dest, { recursive: true, force: true });
  cpSync(sourceDir, dest, { recursive: true });
  writeFileSync(path.join(dest, OWNER_MARKER), OWNER_MARKER_BODY);
  for (const [file, content] of Object.entries(extras)) writeFileSync(path.join(dest, file), content);
  return "installed";
}

// The skills roots the config skill is installed into: claude's user-global dir and codex's.
function skillsRoots(): string[] {
  return [path.join(os.homedir(), ".claude", "skills"), codexSkillsRoot()];
}

// The generated JSON Schema rides along with the config skill only, so it validates against the
// exact live shape rather than a hand-copied one that could drift. NOT named `schema.json`: the
// collections engine treats any skill dir holding that exact filename as a user-scope collection
// definition, and would log a validation failure for ours.
const extrasFor = (name: string): Record<string, string> =>
  name === "mulmoterminal-config" ? { [SCHEMA_ASSET_FILE]: JSON.stringify(dirConfigJsonSchema(), null, 2) + "\n" } : {};

export function installBundledSkills(): void {
  if (process.env.MULMOTERMINAL_NO_SKILL_INSTALL) return;
  for (const root of skillsRoots()) {
    for (const name of BUNDLED_SKILL_NAMES) {
      try {
        mkdirSync(root, { recursive: true });
        installOwnedSkill(bundledSkillDir(name), root, extrasFor(name));
      } catch (err) {
        console.error(`[skills] installing ${name} into ${root} failed — continuing`, err instanceof Error ? err.message : String(err));
      }
    }
  }
}
