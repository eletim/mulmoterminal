import { describe, it, expect } from "vitest";
import { copyOutcomeFor, copyOutcomeMessage, type CopyOutcome } from "../../../src/components/codeBlockCopy";

// #865. Three of the four outcomes are not errors, and the value of separating them is that
// each needs a different sentence — "that reply had no code" and "this transcript is too big to
// read" are both silence from the button otherwise, and only one of them is a limit.
describe("copyOutcomeFor", () => {
  it("returns the last fenced block's body", () => {
    const reply = "here you go\n\n```ts\nconst a = 1;\n```\n\nand that's it";
    expect(copyOutcomeFor({ reply })).toEqual({ kind: "ok", text: "const a = 1;", lang: "ts" });
  });

  it("keeps the block's own indentation and blank lines", () => {
    const body = "function f() {\n  if (x) {\n\n    return 1;\n  }\n}";
    expect(copyOutcomeFor({ reply: "```js\n" + body + "\n```" })).toMatchObject({ kind: "ok", text: body });
  });

  it("reports no-code for a reply that is only prose", () => {
    expect(copyOutcomeFor({ reply: "I changed three files and pushed." })).toEqual({ kind: "no-code" });
  });

  // The size refusal rides on the same response as the turn, and the reply it comes with is
  // necessarily empty — so it has to be read FIRST or it reads as "no completed turn".
  it("reports too-large ahead of the empty reply that comes with it", () => {
    expect(copyOutcomeFor({ reply: null, tooLarge: true })).toEqual({ kind: "too-large" });
  });

  it.each([
    ["a session with nothing on disk yet", null],
    ["an empty reply", ""],
  ])("reports no-turn for %s", (_case, reply) => {
    expect(copyOutcomeFor({ reply })).toEqual({ kind: "no-turn" });
  });
});

describe("copyOutcomeMessage", () => {
  // Every outcome must say something. A missing case would surface as an empty toast, which is
  // exactly the "the button does nothing" complaint this feature is meant to avoid.
  it.each<CopyOutcome>([{ kind: "ok", text: "x", lang: null }, { kind: "no-code" }, { kind: "too-large" }, { kind: "no-turn" }])(
    "has a message for %o",
    (outcome) => {
      expect(copyOutcomeMessage(outcome).length).toBeGreaterThan(0);
    },
  );

  it("does not call any of them a failure — none is something a retry fixes", () => {
    const messages = (["no-code", "too-large", "no-turn"] as const).map((kind) => copyOutcomeMessage({ kind }));
    messages.forEach((m) => expect(m.toLowerCase()).not.toContain("error"));
  });
});
