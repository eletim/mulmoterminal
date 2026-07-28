import { describe, it, expect } from "vitest";
import { createSummaryScan } from "../../../server/session/summary-scan.js";
import {
  aiTitleFromParsed,
  countUserTurnsFromParsed,
  currentTurnToolNamesFromParsed,
  latestAssistantTextFromParsed,
  latestMeaningfulUserPromptFromParsed,
  latestTurnContextFromParsed,
  sessionUsageFromParsed,
} from "../../../server/session/transcript.js";

// The scan replaced "parse the whole file, then fold it seven ways" (#998). What has to hold is
// that it produces the SAME answers — so every case here is asserted against the original
// functions on the same records, rather than against hand-written expectations that could drift.

const RESPONSE_MAX = 400;

const user = (text: string) => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const assistant = (text: string, over: Record<string, unknown> = {}) => ({
  type: "assistant",
  message: {
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
    ...over,
  },
});
const toolCall = (name: string) => ({
  type: "assistant",
  message: { role: "assistant", model: "claude-opus-5", content: [{ type: "tool_use", name, input: {} }] },
});

const scanned = (records: Record<string, unknown>[]) => {
  const scan = createSummaryScan();
  records.forEach((r) => scan.add(r));
  return scan.finish(RESPONSE_MAX);
};

const folded = (records: Record<string, unknown>[]) => ({
  lastPrompt: latestMeaningfulUserPromptFromParsed(records),
  aiTitle: aiTitleFromParsed(records),
  lastResponse: latestAssistantTextFromParsed(records)?.slice(0, RESPONSE_MAX) ?? null,
  userTurns: countUserTurnsFromParsed(records),
  usage: sessionUsageFromParsed(records),
  context: latestTurnContextFromParsed(records),
  toolNames: currentTurnToolNamesFromParsed(records),
});

describe("createSummaryScan agrees with the whole-array fold", () => {
  it.each([
    ["an empty session", []],
    ["one exchange", [user("hello"), assistant("hi")]],
    ["several turns", [user("one"), assistant("a"), user("two"), assistant("b"), user("three"), assistant("c")]],
    ["a turn still in progress", [user("do it"), toolCall("Read"), toolCall("Edit")]],
    ["an AI title, which the newest wins", [user("q"), { type: "ai-title", aiTitle: "first" }, assistant("a"), { type: "ai-title", aiTitle: "second" }]],
    ["records that are neither user nor assistant", [{ type: "system", note: "x" }, user("q"), { type: "summary" }, assistant("a")]],
    ["an assistant turn carrying no usage", [user("q"), assistant("a", { usage: undefined })]],
  ])("on %s", (_case, records) => {
    expect(scanned(records as Record<string, unknown>[])).toEqual(folded(records as Record<string, unknown>[]));
  });

  // Usage is the one field that must see EVERY record — a fold that only looked at a tail window
  // would quietly under-report the cost of a long session.
  it("totals usage across more records than the tail window keeps", () => {
    const many = Array.from({ length: 1200 }, (_, i) => (i % 2 === 0 ? user(`q${i}`) : assistant(`a${i}`)));
    const result = scanned(many);
    expect(result).toEqual(folded(many));
    expect(result.usage.inputTokens).toBe(600 * 10);
    expect(result.userTurns).toBe(600);
  });

  // …while the end-of-session fields describe the END, so they must not be dragged back by
  // everything that came before.
  it("reports the newest prompt and reply from a long session", () => {
    const many = [
      ...Array.from({ length: 1200 }, (_, i) => (i % 2 === 0 ? user(`q${i}`) : assistant(`a${i}`))),
      user("the last question"),
      assistant("the last answer"),
    ];
    const result = scanned(many);
    expect(result.lastPrompt).toBe("the last question");
    expect(result.lastResponse).toBe("the last answer");
    expect(result).toEqual(folded(many));
  });

  it("truncates a long reply at the caller's cap", () => {
    const long = "x".repeat(RESPONSE_MAX + 50);
    expect(scanned([user("q"), assistant(long)]).lastResponse).toHaveLength(RESPONSE_MAX);
  });
});
