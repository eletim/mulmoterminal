// @vitest-environment node
// The rot detector for the shipped FAQ. Its entries point at config keys and files instead of
// quoting values, precisely so that a rename breaks a test here rather than misleading a user
// months later. Referenced-issue state is deliberately NOT checked — that needs the network, and a
// unit test that reaches GitHub fails for reasons that have nothing to do with the change.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entryHasPointer, parseFaqEntries } from "../../../server/skills/faqEntries";
import { emptyConfig } from "../../../server/config/app-config";
import { dirConfigJsonSchema } from "../../../server/config/config-schema";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKILL_DIR = path.join(REPO_ROOT, "server", "skills", "mulmoterminal-bug-report");
const faq = readFileSync(path.join(SKILL_DIR, "faq.md"), "utf8");
const entries = parseFaqEntries(faq);

const knownConfigKeys = new Set([...Object.keys(emptyConfig()), ...Object.keys(dirConfigJsonSchema().properties ?? {})]);

describe("the bundled FAQ", () => {
  it("has entries at all — an empty index would make Step 2 of the skill a no-op", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("gives every entry something checkable to follow", () => {
    expect(entries.filter((entry) => !entryHasPointer(entry)).map((entry) => entry.symptom)).toEqual([]);
  });

  it("names only config keys that still exist", () => {
    const unknown = entries.flatMap((entry) => entry.configKeys.filter((key) => !knownConfigKeys.has(key)).map((key) => `${entry.symptom}: ${key}`));
    expect(unknown).toEqual([]);
  });

  it("names only files that still exist", () => {
    const missing = entries.flatMap((entry) =>
      [...entry.sources, ...entry.guides].filter((rel) => !existsSync(path.join(REPO_ROOT, rel))).map((rel) => `${entry.symptom}: ${rel}`),
    );
    expect(missing).toEqual([]);
  });

  // The whole point of the format: a value written here is a value nobody will come back to update.
  // A heuristic, and only over the entries — the preamble above the `---` explains the rule and has
  // to be able to quote the phrasing it forbids.
  it("stays an index — no entry quotes the default of a setting", () => {
    expect(faq.slice(faq.indexOf("\n---\n"))).not.toMatch(/default is\s+`?["'\w]/i);
  });
});

describe("the bug-report skill", () => {
  const skill = readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");

  it("declares the name the slash command resolves to", () => {
    expect(skill).toMatch(/^---\nname: mulmoterminal-bug-report\n/);
  });

  // Claude picks a skill by its description alone, so it has to carry the symptom words a user
  // actually types, not just the formal name of the feature.
  it("describes itself in the words a stuck user would use", () => {
    const description = /\ndescription: (.+)\n/.exec(skill)?.[1] ?? "";
    for (const word of ["broken", "not working", "report", "issue"]) expect(description.toLowerCase()).toContain(word);
  });

  it("keeps filing an issue as the last step, after the three that can resolve it first", () => {
    const steps = [...skill.matchAll(/^## Step (\d)/gm)].map((m) => m[1]);
    expect(steps).toEqual(["1", "2", "3", "4"]);
    expect(skill.indexOf("gh issue create")).toBeGreaterThan(skill.indexOf("## Step 4"));
  });
});
