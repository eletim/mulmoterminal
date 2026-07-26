import { describe, it, expect } from "vitest";
import { withFooter, workdirFooter } from "../../../server/git/pr-footer.js";

const FOOTER = "work in mulmoclaude3";

describe("workdirFooter", () => {
  it.each([
    ["a repo root", "/Users/u/ss/llm/mulmoclaude3", "work in mulmoclaude3"],
    ["a path with a trailing separator", "/Users/u/ss/llm/mulmoclaude3/", "work in mulmoclaude3"],
    ["a clone whose name has spaces", "/Users/u/my projects/mulmo terminal", "work in mulmo terminal"],
  ])("names the clone from %s", (_case, repoRoot, expected) => {
    expect(workdirFooter(repoRoot)).toBe(expected);
  });
});

describe("withFooter", () => {
  it.each([
    ["a plain body", "Fixes the login bug.", "Fixes the login bug."],
    // gh's `--jq .body` ends with a newline; appending onto it would leave a three-line gap.
    ["the trailing newline gh returns", "Fixes the login bug.\n", "Fixes the login bug."],
    ["markdown with blank lines of its own", "## What\n\n- one\n- two", "## What\n\n- one\n- two"],
    // Prose that merely CONTAINS the words is not our line — a substring check would skip this.
    ["a line that only contains the footer text", "I did the work in mulmoclaude3 and 4.", "I did the work in mulmoclaude3 and 4."],
    ["another clone's footer", "Fixes it.\n\nwork in mulmoclaude2", "Fixes it.\n\nwork in mulmoclaude2"],
  ])("appends the line after %s", (_case, body, kept) => {
    expect(withFooter(body, FOOTER)).toBe(`${kept}\n\n${FOOTER}`);
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "\n\n  \n"],
  ])("is the whole body when the body is %s", (_case, body) => {
    expect(withFooter(body, FOOTER)).toBe(FOOTER);
  });

  it.each([
    ["already ends with the footer", `Fixes the login bug.\n\n${FOOTER}`],
    // A body edited on GitHub can come back CRLF; a footer that failed to match there would
    // be appended a second time.
    ["came back CRLF", `Fixes the login bug.\r\n\r\n${FOOTER}\r\n`],
    ["carries the footer above later text", `${FOOTER}\n\nmore notes added later`],
  ])("leaves the body untouched when it %s", (_case, body) => {
    expect(withFooter(body, FOOTER)).toBe(body);
  });
});
