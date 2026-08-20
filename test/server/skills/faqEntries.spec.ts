// @vitest-environment node
import { describe, it, expect } from "vitest";
import { entryHasPointer, parseFaqEntries } from "../../../server/skills/faqEntries";

describe("parseFaqEntries", () => {
  it("reads a heading and its pointers as one entry", () => {
    const entries = parseFaqEntries(["## Enter does not submit", "", "configKey: terminalSubmit", "source: common/terminalSubmit.ts", "", "prose"].join("\n"));
    expect(entries).toEqual([{ symptom: "Enter does not submit", configKeys: ["terminalSubmit"], sources: ["common/terminalSubmit.ts"], guides: [] }]);
  });

  it("keeps every value when a field repeats", () => {
    const [entry] = parseFaqEntries("## S\nsource: a.ts\nsource: b.ts\nguide: docs/g.md\n");
    expect(entry.sources).toEqual(["a.ts", "b.ts"]);
    expect(entry.guides).toEqual(["docs/g.md"]);
  });

  it("splits entries at each heading and keeps their order", () => {
    const entries = parseFaqEntries("## First\nconfigKey: a\n\n## Second\nconfigKey: b\n");
    expect(entries.map((e) => [e.symptom, e.configKeys])).toEqual([
      ["First", ["a"]],
      ["Second", ["b"]],
    ]);
  });

  // The file opens with a fenced example of the entry format. Parsing it would invent an entry
  // whose pointers ("<a global or per-directory config key>") no test could ever satisfy.
  it("ignores fenced code blocks, so the format example is not read as an entry", () => {
    const entries = parseFaqEntries(["```", "## Example", "configKey: <a key>", "```", "## Real", "configKey: pushKinds"].join("\n"));
    expect(entries.map((e) => e.symptom)).toEqual(["Real"]);
  });

  it("drops a field line that precedes the first heading", () => {
    expect(parseFaqEntries("configKey: orphan\n\n## S\n")).toEqual([{ symptom: "S", configKeys: [], sources: [], guides: [] }]);
  });

  it("ignores a heading of another level and an unknown field", () => {
    const entries = parseFaqEntries("# Title\n### Sub\n## S\nnote: ignore me\nconfigKey: kept\n");
    expect(entries.map((e) => e.symptom)).toEqual(["S"]);
    expect(entries[0].configKeys).toEqual(["kept"]);
  });

  it("ignores a field line with no value", () => {
    expect(parseFaqEntries("## S\nconfigKey:\nconfigKey:   \n")[0].configKeys).toEqual([]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseFaqEntries("")).toEqual([]);
  });
});

describe("entryHasPointer", () => {
  it("accepts an entry carrying any one kind of pointer", () => {
    expect(entryHasPointer({ symptom: "s", configKeys: ["k"], sources: [], guides: [] })).toBe(true);
    expect(entryHasPointer({ symptom: "s", configKeys: [], sources: ["a.ts"], guides: [] })).toBe(true);
    expect(entryHasPointer({ symptom: "s", configKeys: [], sources: [], guides: ["d.md"] })).toBe(true);
  });

  it("rejects an entry with none — prose the skill cannot check against the running system", () => {
    expect(entryHasPointer({ symptom: "s", configKeys: [], sources: [], guides: [] })).toBe(false);
  });
});
