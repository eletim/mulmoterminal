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

// The answer to one question, out of the tool_result's prose. The harness writes the answers as
// `"<question>"="<answer>"` pairs behind one of several lead-ins ("The user answered:", "Your
// questions have been answered:"), and appends its own trailing sentence — and sometimes a
// `selected preview:` block — after the closing quote. So the answer is read from the marker up
// to the FIRST closing quote rather than by splitting the sentence, which keeps it independent of
// wording we do not control. An answer containing a literal `"` would truncate there; none of the
// 900 recorded on this machine does.
function answerFor(question: string, text: string): string | null {
  const marker = `"${question}"="`;
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const from = start + marker.length;
  const end = text.indexOf('"', from);
  return (end < 0 ? text.slice(from) : text.slice(from, end)).trim() || null;
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
  return raw.filter(isRecord).map((q) => {
    const question = str(q.question);
    const options = optionsOf(q.options);
    const answer = text === null ? null : answerFor(question, text);
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
