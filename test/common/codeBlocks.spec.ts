import { describe, it, expect } from "vitest";
import { fencedBlocks, lastFencedBlock } from "../../common/codeBlocks";

// #865. The value of this feature is that what lands on the clipboard is byte-for-byte what the
// agent wrote — so the cases that matter are the ones where a naive split would quietly change
// it: indentation inside the block, a fence character appearing in the content, a block that
// was never closed.
const md = (...lines: string[]) => lines.join("\n");

describe("fencedBlocks", () => {
  it("returns the body verbatim, including blank lines and indentation", () => {
    const body = md("function f() {", "  return 1;", "", "}");
    expect(fencedBlocks(md("prose", "```ts", body, "```", "more prose"))).toEqual([{ lang: "ts", body }]);
  });

  it("reads the language from the info string, lower-cased, ignoring the rest of the line", () => {
    expect(fencedBlocks(md("```TS title=foo.ts", "x", "```"))[0].lang).toBe("ts");
  });

  it("reports no language when the fence carries none", () => {
    expect(fencedBlocks(md("```", "x", "```"))[0].lang).toBeNull();
  });

  it("finds every block, in order", () => {
    expect(fencedBlocks(md("```", "one", "```", "text", "```", "two", "```")).map((b) => b.body)).toEqual(["one", "two"]);
  });

  it("accepts ~~~ as a fence", () => {
    expect(fencedBlocks(md("~~~bash", "echo hi", "~~~"))).toEqual([{ lang: "bash", body: "echo hi" }]);
  });

  // The reason the closer has to match the OPENER rather than any fence: a shell snippet that
  // itself contains ``` is ordinary in this app's output, and cutting the block there would hand
  // over half a command.
  it("does not close a ~~~~ block on a ``` inside it", () => {
    const body = md("run this:", "```", "ls -la", "```");
    expect(fencedBlocks(md("~~~~", body, "~~~~"))).toEqual([{ lang: null, body }]);
  });

  it("does not close a longer fence on a shorter one of the same character", () => {
    const body = md("```", "nested", "```");
    expect(fencedBlocks(md("````", body, "````"))[0].body).toBe(body);
  });

  it("closes on a longer run of the same character", () => {
    expect(fencedBlocks(md("```", "x", "`````"))[0].body).toBe("x");
  });

  // A closing fence may carry no info string. A line like ```js is therefore CONTENT of the
  // open block, not its end — which is what keeps a reply that quotes markdown (a fenced block
  // showing another fenced block) from being cut at the inner one.
  it("does not close on a fence that carries an info string", () => {
    expect(fencedBlocks(md("```", "x", "```js", "y", "```"))).toEqual([{ lang: null, body: md("x", "```js", "y") }]);
  });

  it("tolerates trailing whitespace on the closing fence", () => {
    expect(fencedBlocks(md("```", "x", "```   "))[0].body).toBe("x");
  });

  it("accepts a fence indented up to three spaces", () => {
    expect(fencedBlocks(md("   ```", "x", "   ```"))[0].body).toBe("x");
  });

  // An agent cut off mid-block is precisely when someone reaches for this; returning nothing
  // would read as "there is no code in that reply".
  it("returns an unclosed block, running to the end", () => {
    expect(fencedBlocks(md("```py", "print(1)", "print(2)"))).toEqual([{ lang: "py", body: md("print(1)", "print(2)") }]);
  });

  it.each([
    ["no fences at all", "just prose"],
    ["an empty string", ""],
  ])("returns nothing for %s", (_case, input) => {
    expect(fencedBlocks(input)).toEqual([]);
  });

  it("returns an empty body for an empty block rather than dropping it", () => {
    expect(fencedBlocks(md("```", "```"))).toEqual([{ lang: null, body: "" }]);
  });
});

describe("lastFencedBlock", () => {
  it("takes the last block — what 'the code you just gave me' means", () => {
    expect(lastFencedBlock(md("```", "first", "```", "```", "second", "```"))?.body).toBe("second");
  });

  // An empty clipboard is indistinguishable from a copy that failed, so an empty trailing block
  // must not win over a real one above it.
  it("skips a trailing empty block in favour of the last real one", () => {
    expect(lastFencedBlock(md("```", "real", "```", "```", "   ", "```"))?.body).toBe("real");
  });

  it.each([
    ["a reply with no code", "no code here"],
    ["only empty blocks", md("```", "```")],
  ])("returns null for %s", (_case, input) => {
    expect(lastFencedBlock(input)).toBeNull();
  });
});
