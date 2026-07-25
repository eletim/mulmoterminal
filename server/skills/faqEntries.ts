// The bug-report skill's FAQ is an index of WHERE to check, never of what a value is — values go
// stale silently, a config key or a path cannot (rename one and the implementation stops working).
// That only holds if the pointers are real, so they are parsed out here and checked by a test:
// a key that no longer exists fails CI instead of misleading a user months later.

export interface FaqEntry {
  symptom: string;
  configKeys: string[];
  sources: string[];
  guides: string[];
}

type FieldList = "configKeys" | "sources" | "guides";

// A Map, not an object literal: the key comes from arbitrary prose, and `FIELDS["constructor"]`
// on a literal would answer through the prototype chain instead of missing.
const FIELDS = new Map<string, FieldList>([
  ["configKey", "configKeys"],
  ["source", "sources"],
  ["guide", "guides"],
]);

const HEADING = "## ";

const newEntry = (symptom: string): FaqEntry => ({ symptom, configKeys: [], sources: [], guides: [] });

// `## symptom` opens an entry; `field: value` lines under it are its pointers. Everything else is
// prose for the model to read. A field line before the first heading belongs to no entry and is
// dropped — the format block at the top of the file is documentation, not an entry.
export function parseFaqEntries(markdown: string): FaqEntry[] {
  const entries: FaqEntry[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    if (line.startsWith(HEADING)) {
      entries.push(newEntry(line.slice(HEADING.length).trim()));
      continue;
    }
    const colon = line.indexOf(":");
    const list = colon > 0 ? FIELDS.get(line.slice(0, colon)) : undefined;
    const value = line.slice(colon + 1).trim();
    const current = entries[entries.length - 1];
    if (list && value && current) current[list].push(value);
  }
  return entries;
}

// An entry with no pointer at all is prose the skill cannot verify against the running system,
// which is exactly what this format exists to prevent.
export const entryHasPointer = (entry: FaqEntry): boolean => entry.configKeys.length + entry.sources.length + entry.guides.length > 0;
