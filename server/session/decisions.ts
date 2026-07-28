// Reading past decisions back out of a Claude transcript (#997, step 1 of #991).
//
// Fed one line at a time rather than a parsed file, for two reasons measured on real transcripts:
// this machine has a 585 MB one, which `readFileSync(..., "utf8")` cannot even represent
// (`ERR_STRING_TOO_LONG` above ~512 MB), and holding every tool result to look for an answer
// costs more memory than the answers are worth. A streaming scan keeps both bounded, and the
// lines that matter are a rounding error in the file.
import type { DecisionAnswerKind, DecisionOption, DecisionQuestion, DecisionRecord } from "../../common/decisionLog.js";
import { isRecord } from "../../common/isRecord.js";
import { splitLines } from "../infra/split-lines.js";

const ASK_TOOL = "AskUserQuestion";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const optionsOf = (raw: unknown): DecisionOption[] =>
  Array.isArray(raw) ? raw.filter(isRecord).map((o) => ({ label: str(o.label), description: str(o.description) })) : [];

// A tool_result's text, whether the harness wrote it as a plain string or as content blocks.
const resultText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isRecord)
    .map((b) => str(b.text))
    .join("\n");
};

// Answers are unquoted prose inside quotes: the harness writes `"<question>"="<answer>"` pairs
// behind a lead-in ("The user answered:", "Your questions have been answered:") and escapes
// nothing, so an answer may contain `"` of its own — measured, 35 of 554 recorded result strings
// do, e.g. `"A: #app に translate="no"（推奨）"`. Stopping at the first quote truncated those, and a
// truncated answer stops matching its option label, which lands it in the free-text bucket this
// whole record exists to keep meaningful.
//
// So the end of an answer is found structurally wherever possible: another question's marker can
// only start after the previous answer closed, and those markers are exact (a question's own
// quotes are inside the marker, so they never confuse it). Only the LAST answer has no marker
// after it, and there the harness's own tail is the boundary.
const ANSWER_TAILS = [". ", ".\n", " selected preview:"];

const markerOf = (question: string): string => `"${question}"="`;

// The first quote at or after `from` that the harness's trailing text follows, or -1.
function tailQuote(text: string, from: number): number {
  for (let i = text.indexOf('"', from); i >= 0; i = text.indexOf('"', i + 1)) {
    const rest = text.slice(i + 1);
    if (rest === "" || ANSWER_TAILS.some((tail) => rest.startsWith(tail))) return i;
  }
  return -1;
}

// Where this answer ends: whichever comes FIRST of the next question's marker and the harness's
// own tail. Both are needed and neither alone is right — measured on real results. A preview block
// is written between an answer and the next question, so bounding only by the next marker swallows
// it; and a tail search alone runs past the next question, because the tail it finds belongs to
// the LAST answer in the string. If neither is found the shape is one we don't know, and the first
// quote is the floor: truncating loses characters, while over-capturing files unrelated text as
// something the user said.
function answerEnd(text: string, from: number, laterMarkers: number[]): number {
  const next = laterMarkers.filter((m) => m > from).sort((a, b) => a - b)[0];
  const tail = tailQuote(text, from);
  const bounds = [next, tail >= 0 ? tail : undefined].filter((n): n is number => n !== undefined);
  if (bounds.length > 0) return Math.min(...bounds);
  const firstQuote = text.indexOf('"', from);
  return firstQuote < 0 ? text.length : firstQuote;
}

function answerFor(question: string, text: string, laterMarkers: number[]): string | null {
  const start = text.indexOf(markerOf(question));
  if (start < 0) return null;
  const from = start + markerOf(question).length;
  return (
    text
      .slice(from, answerEnd(text, from, laterMarkers))
      .replace(/",\s*$/, "") // the `", ` that separates this pair from the next
      .trim() || null
  );
}

// A multi-select answer comes back as the chosen labels joined by ", ", so every part has to be a
// real label before the whole counts as chosen-from-options. Anything else is the user writing
// their own answer, which is the case worth being able to find later.
function classifyAnswer(answer: string | null, options: DecisionOption[]): DecisionAnswerKind {
  if (answer === null) return "unanswered";
  const labels = new Set(options.map((o) => o.label));
  if (labels.has(answer)) return "option";
  const parts = answer.split(", ");
  return parts.length > 1 && parts.every((p) => labels.has(p)) ? "option" : "free-text";
}

function questionsOf(input: unknown, text: string | null): DecisionQuestion[] {
  const raw = isRecord(input) && Array.isArray(input.questions) ? input.questions : [];
  // Every question's marker position, so each answer can be bounded by the next question rather
  // than by the first quote it happens to contain.
  const markers =
    text === null
      ? []
      : raw
          .filter(isRecord)
          .map((q) => text.indexOf(markerOf(str(q.question))))
          .filter((i) => i >= 0);
  return raw.filter(isRecord).map((q) => {
    const question = str(q.question);
    const options = optionsOf(q.options);
    const answer = text === null ? null : answerFor(question, text, markers);
    return { question, header: str(q.header), multiSelect: q.multiSelect === true, options, answer, answerKind: classifyAnswer(answer, options) };
  });
}

interface Ask {
  toolUseId: string;
  ts: string;
  cwd: string | null;
  sessionId: string;
  input: unknown;
  resultText: string | null;
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const o: unknown = JSON.parse(line);
    return isRecord(o) ? o : null;
  } catch {
    return null;
  }
}

const contentBlocks = (o: Record<string, unknown>): Record<string, unknown>[] => {
  const content = isRecord(o.message) ? o.message.content : undefined;
  return Array.isArray(content) ? content.filter(isRecord) : [];
};

function collectAsks(o: Record<string, unknown>, asks: Ask[], awaiting: Map<string, Ask>): void {
  if (o.type !== "assistant") return;
  for (const block of contentBlocks(o)) {
    if (block.type !== "tool_use" || block.name !== ASK_TOOL) continue;
    const ask: Ask = {
      toolUseId: str(block.id),
      ts: str(o.timestamp),
      cwd: str(o.cwd) || null,
      sessionId: str(o.sessionId),
      input: block.input,
      resultText: null,
    };
    asks.push(ask);
    if (ask.toolUseId) awaiting.set(ask.toolUseId, ask);
  }
}

function collectAnswer(o: Record<string, unknown>, awaiting: Map<string, Ask>): void {
  for (const block of contentBlocks(o)) {
    if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
    const ask = awaiting.get(block.tool_use_id);
    if (!ask) continue;
    ask.resultText = resultText(block.content);
    awaiting.delete(block.tool_use_id);
  }
}

export interface DecisionScan {
  /** Feed one JSONL line, in file order — an answer always trails its question. */
  addLine(line: string): void;
  /** The decisions found so far, oldest first. `fallbackSessionId` covers a line that carries none. */
  finish(fallbackSessionId: string): DecisionRecord[];
}

const mentionsPendingAsk = (line: string, awaiting: Map<string, Ask>): boolean => {
  for (const id of awaiting.keys()) {
    if (line.includes(id)) return true;
  }
  return false;
};

export function createDecisionScan(): DecisionScan {
  const asks: Ask[] = [];
  const awaiting = new Map<string, Ask>();
  return {
    addLine(line) {
      // Substring tests before JSON.parse. Only a handful of lines in a transcript are a question
      // or its answer, and parsing the rest is what makes scanning a large session expensive; a
      // false positive here costs one parse and is then rejected on structure.
      //
      // BOTH tests run on every candidate line, and neither short-circuits the other: a line can
      // carry the word AskUserQuestion and still be somebody's answer — "AskUserQuestion って
      // 何？" typed as a free-text answer is the case both reviewers caught, and it would have
      // recorded a question the user did answer as unanswered.
      const isAsk = line.includes(ASK_TOOL);
      const isAnswer = awaiting.size > 0 && mentionsPendingAsk(line, awaiting);
      if (!isAsk && !isAnswer) return;
      const o = parseLine(line);
      if (!o) return;
      if (isAsk) collectAsks(o, asks, awaiting);
      if (isAnswer) collectAnswer(o, awaiting);
    },
    finish(fallbackSessionId) {
      return asks
        .map((a) => ({
          sessionId: a.sessionId || fallbackSessionId,
          cwd: a.cwd,
          ts: a.ts,
          toolUseId: a.toolUseId,
          questions: questionsOf(a.input, a.resultText),
        }))
        .filter((d) => d.questions.length > 0);
    },
  };
}

/** Whole-file convenience for callers that already hold the text (and for tests). Streaming
 *  callers feed `createDecisionScan()` directly — see server/routes/decision-routes.ts. */
export function decisionsFromJsonl(raw: string, fallbackSessionId: string): DecisionRecord[] {
  const scan = createDecisionScan();
  for (const line of splitLines(raw)) scan.addLine(line);
  return scan.finish(fallbackSessionId);
}

/** Newest first. A record with no timestamp sorts last rather than jumping to the top. */
export const byNewest = (a: DecisionRecord, b: DecisionRecord): number => (b.ts || "").localeCompare(a.ts || "");
