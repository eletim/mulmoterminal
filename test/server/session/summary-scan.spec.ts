// @vitest-environment node
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

  // Codex on #1037: the current turn's tools were read from a fixed 400-record window, so a long
  // turn's early edits fell out of it and workPhase regressed from implementing to planning. A turn
  // has no bound — measured across the eight largest transcripts here, the longest spans 3,615
  // records — so this asserts a turn far past any window keeps the tool it opened with.
  it("keeps a tool from the START of a turn that runs longer than the tail window", () => {
    const records = [user("do the thing"), toolCall("Edit"), ...Array.from({ length: 900 }, () => toolCall("Read"))];
    const result = scanned(records);
    expect(result.toolNames[0]).toBe("Edit");
    expect(result).toEqual(folded(records));
  });

  // …and the reset still happens: a NEW prompt drops the previous turn's tools however long ago.
  it("forgets the previous turn's tools once a new prompt arrives", () => {
    const records = [user("first"), toolCall("Edit"), ...Array.from({ length: 900 }, () => toolCall("Read")), user("second"), toolCall("Grep")];
    expect(scanned(records).toolNames).toEqual(["Grep"]);
  });

  // The same trap as the prompt and the tools: a reply or a model that only appears BEFORE a long
  // run of tool calls must still be reported. Reaching for a record window loses all three.
  it("reports the reply and model from a turn that then ran far past the window", () => {
    const records = [user("q"), assistant("the answer"), ...Array.from({ length: 900 }, () => toolCall("Read"))];
    const result = scanned(records);
    expect(result.lastResponse).toBe("the answer");
    expect(result.context.model).toBe("claude-opus-5");
    expect(result).toEqual(folded(records));
  });

  // Codex on #1037, round 2. Both of these are fallbacks the original rules have and a naive
  // "remember the newest X" loses.
  it("uses a last-prompt record when the transcript has no user line", () => {
    const records = [{ type: "last-prompt", lastPrompt: "recorded by the hook" }, assistant("a")];
    expect(scanned(records).lastPrompt).toBe("recorded by the hook");
    expect(scanned(records)).toEqual(folded(records));
  });

  it("prefers a real user line over a last-prompt record", () => {
    const records = [{ type: "last-prompt", lastPrompt: "recorded" }, user("typed"), assistant("a")];
    expect(scanned(records).lastPrompt).toBe("typed");
  });

  // The context comes from the LAST assistant message as a unit — model and tokens together. A
  // final turn that names no model reports null, not the model from an earlier turn.
  it("reports the last assistant turn's context even when that turn names no model", () => {
    const records = [user("q"), assistant("a"), assistant("b", { model: undefined })];
    expect(scanned(records).context).toEqual(folded(records).context);
    expect(scanned(records).context.model).toBeNull();
  });

  it("truncates a long reply at the caller's cap", () => {
    const long = "x".repeat(RESPONSE_MAX + 50);
    expect(scanned([user("q"), assistant(long)]).lastResponse).toHaveLength(RESPONSE_MAX);
  });
});
