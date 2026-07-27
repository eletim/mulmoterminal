import { describe, it, expect } from "vitest";
import { parsePaneStore, rememberPane, recallPane, MAX_REMEMBERED_DIRS, MAX_EXPANDED_PATHS, type RememberedPane } from "../../../src/components/filesPaneStore";

// #958. The directory-keyed layer that survives a reload. It is a convenience, so every
// failure mode here has to degrade to "remembers nothing" rather than to a broken pane —
// which is why the parse is so forgiving and why the caps exist.
const state = (openPath: string | null, expanded: string[] = []) => ({ openPath, expanded });

describe("parsePaneStore", () => {
  it("reads back what rememberPane wrote", () => {
    const store = rememberPane([], "/proj", state("src/main.ts", ["src"]));
    expect(parsePaneStore(JSON.stringify(store))).toEqual(store);
  });

  it.each([
    ["nothing stored yet", null],
    ["an empty string", ""],
    ["not JSON at all", "{half-written"],
    ["JSON that is not an array", '{"cwd":"/proj"}'],
  ])("returns nothing for %s", (_case, raw) => {
    expect(parsePaneStore(raw)).toEqual([]);
  });

  // A foreign or older value under the same key must not take the pane down with it.
  it.each([
    ["a missing cwd", '[{"state":{"openPath":null,"expanded":[]}}]'],
    ["an empty cwd", '[{"cwd":"","state":{"openPath":null,"expanded":[]}}]'],
    ["a missing state", '[{"cwd":"/proj"}]'],
    ["expanded that is not an array", '[{"cwd":"/proj","state":{"openPath":null,"expanded":"src"}}]'],
    ["a non-string inside expanded", '[{"cwd":"/proj","state":{"openPath":null,"expanded":["src",7]}}]'],
    ["openPath of the wrong type", '[{"cwd":"/proj","state":{"openPath":7,"expanded":[]}}]'],
  ])("drops an entry with %s", (_case, raw) => {
    expect(parsePaneStore(raw)).toEqual([]);
  });

  it("keeps the good entries and drops only the bad one", () => {
    const raw = JSON.stringify([{ cwd: "/a", state: state("x.ts") }, { nonsense: true }, { cwd: "/b", state: state(null) }]);
    expect(parsePaneStore(raw).map((e) => e.cwd)).toEqual(["/a", "/b"]);
  });

  // A value written by a build with a larger cap — or by hand — must not come back over either
  // bound. A cap enforced only on write is no cap at all once such a value is in storage, and
  // restore() walks every path in the list.
  it("caps the directory count it reads, not just what it writes", () => {
    const over = Array.from({ length: MAX_REMEMBERED_DIRS + 5 }, (_, i) => ({ cwd: `/p${i}`, state: state(null) }));
    expect(parsePaneStore(JSON.stringify(over))).toHaveLength(MAX_REMEMBERED_DIRS);
  });

  it("caps the expanded list it reads too", () => {
    const huge = Array.from({ length: MAX_EXPANDED_PATHS + 500 }, (_, i) => `dir${i}`);
    const raw = JSON.stringify([{ cwd: "/proj", state: state("a.ts", huge) }]);
    expect(parsePaneStore(raw)[0].state.expanded).toHaveLength(MAX_EXPANDED_PATHS);
  });
});

describe("rememberPane", () => {
  it("puts the newest directory first", () => {
    const store = rememberPane(rememberPane([], "/a", state("a.ts")), "/b", state("b.ts"));
    expect(store.map((e) => e.cwd)).toEqual(["/b", "/a"]);
  });

  // Re-recording a directory has to REPLACE it, or the same cwd accumulates entries and the
  // cap starts evicting other projects to hold copies of one.
  it("replaces a directory rather than appending a second entry", () => {
    const store = rememberPane(rememberPane([], "/a", state("old.ts")), "/a", state("new.ts"));
    expect(store).toHaveLength(1);
    expect(store[0].state.openPath).toBe("new.ts");
  });

  it("drops the least recently used past the cap", () => {
    const full = Array.from({ length: MAX_REMEMBERED_DIRS }, (_, i) => `/p${i}`).reduce<RememberedPane[]>((s, cwd) => rememberPane(s, cwd, state(null)), []);
    const after = rememberPane(full, "/fresh", state(null));
    expect(after).toHaveLength(MAX_REMEMBERED_DIRS);
    expect(after[0].cwd).toBe("/fresh");
    expect(after.map((e) => e.cwd)).not.toContain("/p0"); // the oldest, evicted
  });

  // One directory walked deeply open would otherwise be big enough to fail the whole write on
  // quota — costing every OTHER directory its entry too.
  it("trims a pathological expanded list", () => {
    const huge = Array.from({ length: MAX_EXPANDED_PATHS + 50 }, (_, i) => `dir${i}`);
    expect(rememberPane([], "/proj", state(null, huge))[0].state.expanded).toHaveLength(MAX_EXPANDED_PATHS);
  });
});

describe("recallPane", () => {
  it("finds the directory's own state", () => {
    const store = rememberPane(rememberPane([], "/a", state("a.ts")), "/b", state("b.ts"));
    expect(recallPane(store, "/a")?.openPath).toBe("a.ts");
  });

  it.each([
    ["a directory never seen", "/never"],
    ["no directory at all", null],
  ])("returns null for %s", (_case, cwd) => {
    expect(recallPane(rememberPane([], "/a", state("a.ts")), cwd)).toBeNull();
  });
});
