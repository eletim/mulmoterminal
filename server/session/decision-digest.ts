// The decision record, written out as Markdown for an agent to read before it asks the user
// something (#1015, step toward #991's "past decisions as material").
//
// The file holds EVIDENCE, not rules. It would be easy to write "this user always picks the
// recommended option" and easy for that to be wrong — and #991 names that failure itself: an
// incorrect generalisation applied silently is the worst outcome, worse than having nothing.
// So every line here is a dated thing that happened, and whether it generalises is left to
// whoever reads it.
import type { DecisionQuestion, DecisionRecord } from "../../common/decisionLog.js";

const RECENT_DECISIONS = 20;
const VERBATIM_ENTRIES = 15;
const RECURRING_MIN = 2;
const TOP_RECURRING = 12;

const dateOf = (ts: string): string => (ts.length >= 10 ? ts.slice(0, 10) : "unknown date");

// One line of prose per option, so the reader sees what the alternatives WERE — the description is
// where the consequence of the branch not taken is recorded.
const optionLines = (question: DecisionQuestion): string[] =>
  question.options.map((o) => {
    const why = o.description ? ` — ${o.description}` : "";
    return `  - ${o.label}${why}`;
  });

interface Row {
  ts: string;
  question: DecisionQuestion;
}

const rowsOf = (records: DecisionRecord[]): Row[] => records.flatMap((r) => r.questions.map((question) => ({ ts: r.ts, question })));

function countsSection(rows: Row[]): string[] {
  const kinds = { option: 0, "free-text": 0, unanswered: 0 };
  for (const row of rows) kinds[row.question.answerKind]++;
  return [
    `- Asked: **${rows.length}**`,
    `- Answered by picking an option: **${kinds.option}**`,
    `- Answered in the user's own words instead: **${kinds["free-text"]}**`,
    `- Never answered: **${kinds.unanswered}**`,
  ];
}

// Which topics come up again. Headers are written fresh each time an agent asks, so this groups
// what was actually typed rather than claiming a taxonomy — two labels for one topic stay two
// lines, and that is honest.
function recurringSection(rows: Row[]): string[] {
  const counts = new Map<string, number>();
  for (const { question } of rows) {
    const header = question.header.trim();
    if (header) counts.set(header, (counts.get(header) ?? 0) + 1);
  }
  const repeated = [...counts.entries()]
    .filter(([, n]) => n >= RECURRING_MIN)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_RECURRING);
  if (repeated.length === 0) return ["_Nothing has been asked twice yet._"];
  return repeated.map(([header, n]) => `- \`${header}\` — asked ${n} times`);
}

function entry(row: Row): string[] {
  const q = row.question;
  const lines = [`### ${dateOf(row.ts)} — ${q.header || "(no label)"}`, "", `**Asked:** ${q.question}`, ""];
  if (q.options.length > 0) lines.push("**Options offered:**", ...optionLines(q), "");
  lines.push(q.answer === null ? "**Never answered.**" : `**Answer:** ${q.answer}`, "");
  return lines;
}

function verbatimSection(rows: Row[], kind: DecisionQuestion["answerKind"], empty: string): string[] {
  const matching = rows.filter((r) => r.question.answerKind === kind).slice(0, VERBATIM_ENTRIES);
  return matching.length === 0 ? [empty, ""] : matching.flatMap(entry);
}

function recentSection(rows: Row[]): string[] {
  const chosen = rows.filter((r) => r.question.answerKind === "option").slice(0, RECENT_DECISIONS);
  if (chosen.length === 0) return ["_No option has been chosen yet._", ""];
  return chosen.map((r) => `- ${dateOf(r.ts)} \`${r.question.header || "—"}\` ${r.question.question} → **${r.question.answer}**`);
}

/** `generatedAt` is passed in rather than read from the clock so the output is a pure function of
 *  its inputs — the same records always render the same file. */
export function decisionDigestMarkdown(records: DecisionRecord[], project: string, generatedAt: string): string {
  const rows = rowsOf(records);
  return [
    "# Decisions in this project",
    "",
    `Project: \`${project}\`  `,
    `Generated: ${generatedAt} by MulmoTerminal, from this project's Claude transcripts.`,
    "",
    "**This is a record of what happened, not a set of rules.** Every entry is a question that was",
    "actually asked here and the answer it actually got. Whether any of it generalises is a judgement",
    "for the reader — do not treat a past answer as a standing instruction, and do not act on it",
    "without saying that is what you are doing.",
    "",
    "## How much has been asked",
    "",
    ...countsSection(rows),
    "",
    "## What gets asked more than once",
    "",
    ...recurringSection(rows),
    "",
    "## Questions the user did NOT answer from the options",
    "",
    "The user was offered choices and wrote something else. That is evidence about the QUESTION —",
    "the options missed, or a premise was not shared. These are the most useful entries here.",
    "",
    ...verbatimSection(rows, "free-text", "_Every question so far was answered from its options._"),
    "## Questions that were never answered",
    "",
    "Asked, and nothing came back. Worth reading before asking something similar.",
    "",
    ...verbatimSection(rows, "unanswered", "_Every question so far got an answer._"),
    "## Recent decisions, newest first",
    "",
    ...recentSection(rows),
    "",
  ].join("\n");
}
