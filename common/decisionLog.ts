// A decision a human was asked to make, as it was actually asked and answered.
//
// The record is not something this app writes: Claude Code already stores every
// `AskUserQuestion` in its transcript, options and chosen answer included. These types are the
// shape we read it back in, shared because both the API and the UI decide from them (#997).

/** One option the user was offered, with the reasoning shown alongside it — this is where the
 *  consequence of the branch NOT taken is recorded. */
export interface DecisionOption {
  label: string;
  description: string;
}

/** Where the answer came from. `free-text` means the user declined every option and wrote their
 *  own answer, which is evidence about the QUESTION (wrong options, or a premise the asker and
 *  the user did not share) rather than about the choice. `unanswered` is a question that was
 *  asked and never resolved — the session was interrupted or abandoned. */
export type DecisionAnswerKind = "option" | "free-text" | "unanswered";

export interface DecisionQuestion {
  question: string;
  /** The short chip the UI showed above the question ("進め方", "Auth method"). */
  header: string;
  multiSelect: boolean;
  options: DecisionOption[];
  /** Verbatim, exactly as it came back. Null when nothing came back. */
  answer: string | null;
  answerKind: DecisionAnswerKind;
}

/** One `AskUserQuestion` call: the questions it asked together, and what each got back. */
export interface DecisionRecord {
  sessionId: string;
  cwd: string | null;
  /** ISO timestamp of the turn that asked. */
  ts: string;
  toolUseId: string;
  questions: DecisionQuestion[];
}

export interface DecisionsResponse {
  decisions: DecisionRecord[];
  /** How many transcripts were read. Bounded, so a caller can tell a quiet project from a
   *  truncated scan. */
  scanned: number;
}
