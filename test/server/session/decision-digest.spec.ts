import { describe, it, expect } from "vitest";
import type { DecisionQuestion, DecisionRecord } from "../../../common/decisionLog";
import { decisionDigestMarkdown } from "../../../server/session/decision-digest";

const question = (over: Partial<DecisionQuestion> = {}): DecisionQuestion => ({
  question: "どう進めますか？",
  header: "進め方",
  multiSelect: false,
  options: [
    { label: "今すぐ実装する", description: "ブランチを切って着手" },
    { label: "後で", description: "他を先に" },
  ],
  answer: "今すぐ実装する",
  answerKind: "option",
  ...over,
});

const record = (questions: DecisionQuestion[], ts = "2026-07-27T08:41:43.600Z"): DecisionRecord => ({
  sessionId: "sesn-1",
  cwd: "/home/dev/p",
  ts,
  toolUseId: "toolu_1",
  questions,
});

const digest = (records: DecisionRecord[]): string => decisionDigestMarkdown(records, "/home/dev/p", "2026-07-28T00:00:00.000Z");

describe("decisionDigestMarkdown", () => {
  it("says up front that it is a record, not a set of rules", () => {
    // The whole risk of this file is a wrong generalisation being applied silently (#991). The
    // reader is a language model, so the caveat has to be IN the document.
    const md = digest([record([question()])]);
    expect(md).toContain("record of what happened, not a set of rules");
    expect(md).toContain("do not treat a past answer as a standing instruction");
  });

  it("is a pure function of its inputs — same records, same file", () => {
    const records = [record([question()])];
    expect(digest(records)).toBe(digest(records));
  });

  it("counts how the answers arrived", () => {
    const md = digest([
      record([question(), question({ answerKind: "free-text", answer: "そうじゃなくて…" })]),
      record([question({ answerKind: "unanswered", answer: null })]),
    ]);
    expect(md).toContain("Asked: **3**");
    expect(md).toContain("picking an option: **1**");
    expect(md).toContain("own words instead: **1**");
    expect(md).toContain("Never answered: **1**");
  });

  it("quotes the answers the user wrote instead of choosing, with the options they turned down", () => {
    // The most useful section: it is evidence the QUESTION was wrong, so the options have to be
    // there next to it or the reader cannot see what was rejected.
    const md = digest([record([question({ answerKind: "free-text", answer: "copyOnSelectってなに？" })])]);
    expect(md).toContain("Questions the user did NOT answer from the options");
    expect(md).toContain("copyOnSelectってなに？");
    expect(md).toContain("今すぐ実装する — ブランチを切って着手");
    expect(md).toContain("2026-07-27"); // dated, so the reader can weigh how old it is
  });

  it("lists the questions that were never answered", () => {
    const md = digest([record([question({ question: "これ聞いてよい？", answerKind: "unanswered", answer: null })])]);
    expect(md).toContain("Questions that were never answered");
    expect(md).toContain("これ聞いてよい？");
    expect(md).toContain("**Never answered.**");
  });

  it("reports what gets asked repeatedly without inventing a taxonomy for it", () => {
    const md = digest([record([question({ header: "スコープ" }), question({ header: "スコープ" }), question({ header: "進め方" })])]);
    expect(md).toContain("`スコープ` — asked 2 times");
    expect(md).not.toContain("`進め方` — asked 1"); // asked once is not a pattern
  });

  it("lists recent chosen answers newest-first as the caller ordered them", () => {
    const md = digest([
      record([question({ question: "A?", answer: "今すぐ実装する" })], "2026-07-27T10:00:00Z"),
      record([question({ question: "B?", answer: "後で" })], "2026-07-26T10:00:00Z"),
    ]);
    expect(md.indexOf("A?")).toBeLessThan(md.indexOf("B?"));
    expect(md).toContain("→ **後で**");
  });

  it("says so plainly when a project has no history, instead of rendering an empty skeleton", () => {
    const md = digest([]);
    expect(md).toContain("Asked: **0**");
    expect(md).toContain("_Nothing has been asked twice yet._");
    expect(md).toContain("_Every question so far was answered from its options._");
    expect(md).toContain("_No option has been chosen yet._");
  });

  it("survives a question with no header and no options", () => {
    const md = digest([record([question({ header: "", options: [], answerKind: "free-text", answer: "適当に" })])]);
    expect(md).toContain("(no label)");
    expect(md).toContain("適当に");
  });
});
