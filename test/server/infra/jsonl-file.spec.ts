// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { forEachJsonlLine, readTailLines, readTailRecords } from "../../../server/infra/jsonl-file.js";

// These two exist because `fs.readFile(file, "utf8")` throws past ~512 MB whatever the file holds,
// which silently emptied the longest sessions (#998). What matters in a spec is therefore the
// boundary handling — a reader that starts mid-file, and one that never holds the whole thing.

let dir = "";
const write = (name: string, body: string) => {
  const file = path.join(dir, name);
  writeFileSync(file, body);
  return file;
};

beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "mt-jsonl-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("forEachJsonlLine", () => {
  it("delivers every line in order", async () => {
    const seen: string[] = [];
    await forEachJsonlLine(write("a.jsonl", '{"n":1}\n{"n":2}\n{"n":3}\n'), (l) => seen.push(l));
    expect(seen).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  it("delivers a final line that has no trailing newline", async () => {
    const seen: string[] = [];
    await forEachJsonlLine(write("b.jsonl", '{"n":1}\n{"n":2}'), (l) => seen.push(l));
    expect(seen).toEqual(['{"n":1}', '{"n":2}']);
  });

  it("reads an empty file as no lines", async () => {
    const seen: string[] = [];
    await forEachJsonlLine(write("empty.jsonl", ""), (l) => seen.push(l));
    expect(seen).toEqual([]);
  });

  // A transcript's own content must never be mistaken for a line break — a tool_result carrying
  // \r\n is ordinary here, and readline's crlfDelay is what keeps it from splitting one line in two.
  it("does not split a CRLF pair into an empty line", async () => {
    const seen: string[] = [];
    await forEachJsonlLine(write("crlf.jsonl", '{"n":1}\r\n{"n":2}\r\n'), (l) => seen.push(l));
    expect(seen).toEqual(['{"n":1}', '{"n":2}']);
  });

  it("rejects rather than swallowing a file that isn't there", async () => {
    await expect(forEachJsonlLine(path.join(dir, "missing.jsonl"), () => {})).rejects.toThrow();
  });

  // The reason this is a callback and not "return the lines": the caller keeps a few fields out of
  // hundreds of megabytes, so nothing has to hold them all.
  it("lets the caller keep only what it wants", async () => {
    const body = Array.from({ length: 5000 }, (_, i) => `{"i":${i}}`).join("\n");
    let last = "";
    let count = 0;
    await forEachJsonlLine(write("many.jsonl", body), (l) => {
      count += 1;
      last = l;
    });
    expect(count).toBe(5000);
    expect(last).toBe('{"i":4999}');
  });
});

describe("readTailLines", () => {
  it("returns every line when the file is smaller than the window", () => {
    expect(readTailLines(write("small.jsonl", "one\ntwo\nthree\n"))).toEqual(["one", "two", "three", ""]);
  });

  // The load-bearing case: starting mid-file lands inside a line, and half a line is not JSON.
  it("drops the first line when the read started mid-file", () => {
    const file = write("big.jsonl", `${"x".repeat(100)}\nkept-1\nkept-2\n`);
    expect(readTailLines(file, 20)).toEqual(["kept-1", "kept-2", ""]);
  });

  it("keeps the first line when the whole file fits, so nothing is lost", () => {
    const file = write("fits.jsonl", "first\nsecond\n");
    expect(readTailLines(file, 1024)[0]).toBe("first");
  });

  it("reads only the window, not the file", () => {
    // 2 MB of lines, a 1 KB window: what comes back is bounded by the window.
    const body = Array.from({ length: 40000 }, (_, i) => `line-${i}`).join("\n");
    const file = write("wide.jsonl", `${body}\n`);
    const tail = readTailLines(file, 1024);
    expect(tail.length).toBeLessThan(200);
    expect(tail.at(-2)).toBe("line-39999");
  });

  it.each([
    ["an empty file", ""],
    ["a file of only a newline", "\n"],
  ])("survives %s", (_case, body) => {
    expect(() => readTailLines(write("edge.jsonl", body))).not.toThrow();
  });

  // Every caller wants "no recent turn" rather than an exception — a session whose file was just
  // rotated away must not take the roster down with it.
  it("returns no lines for a file that isn't there", () => {
    expect(readTailLines(path.join(dir, "missing.jsonl"))).toEqual([]);
  });
});

describe("readTailRecords", () => {
  it("parses the records at the end", () => {
    const file = write("recs.jsonl", '{"n":1}\n{"n":2}\n{"n":3}\n');
    expect(readTailRecords(file)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  // The partial first line a mid-file read leaves behind is not JSON, and neither is a corrupt
  // one. Both are skipped rather than taking the whole read down.
  it("skips a line that will not parse", () => {
    const file = write("partial.jsonl", '{"n":1}\nnot json\n{"n":2}\n');
    expect(readTailRecords(file)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("skips a JSON line that is not an object", () => {
    const file = write("scalar.jsonl", '{"n":1}\n42\n"text"\n[1,2]\n{"n":2}\n');
    expect(readTailRecords(file)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("has no records for an empty or missing file", () => {
    expect(readTailRecords(write("none.jsonl", ""))).toEqual([]);
    expect(readTailRecords(path.join(dir, "gone.jsonl"))).toEqual([]);
  });

  // The window has to hold a whole TURN, and one Claude record can carry an entire tool_result.
  // On the 585 MB transcript here the last 256 KB was nine records — not one complete turn — which
  // is why the default is 4 MB and not the codex rollout's 256 KB (#998).
  it("reads far enough back to cover records that are individually huge", () => {
    const fat = (i: number) => JSON.stringify({ i, blob: "x".repeat(200 * 1024) });
    const file = write("fat.jsonl", `${[0, 1, 2, 3, 4, 5].map(fat).join("\n")}\n`);
    const recs = readTailRecords(file);
    // At 256 KB only the last record would survive; the default window keeps several.
    expect(recs.length).toBeGreaterThan(1);
    expect(recs.at(-1)).toMatchObject({ i: 5 });
  });
});
