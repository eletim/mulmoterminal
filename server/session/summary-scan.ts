// Building a session's summary from a stream of records instead of an array of them.
//
// `readSessionSummary` produced all seven fields in one pass over `parseJsonl(readFile(...))`,
// which is the pass that cannot run at all on a transcript past ~512 MB (#998). Each field was
// already a fold over the records — the only thing holding them together was the array.
//
// So this keeps every existing `…FromParsed` rule exactly as it is and feeds each one a window
// rather than the file: the fields that genuinely need every record (usage, turn counts, the AI
// title) accumulate as records arrive, and the ones that only describe the END of the session
// (last prompt, last reply, model/context, current tools) read a bounded tail buffer. Nothing here
// re-implements a rule; splitting them apart is the whole change.
import {
  aiTitleFromParsed,
  countUserTurnsFromParsed,
  currentTurnToolNamesFromParsed,
  latestAssistantTextFromParsed,
  latestMeaningfulUserPromptFromParsed,
  latestTurnContextFromParsed,
  sessionUsageFromParsed,
} from "./transcript.js";
import type { LatestTurnContext, SessionUsage } from "./transcript.js";

// How many records to keep for the "what happened at the end" fields. A turn spans several
// records (prompt, assistant text, tool calls, results), and `currentTurnToolNames` walks back to
// the last user prompt — 400 covers that with room to spare while staying a fixed cost.
const TAIL_RECORDS = 400;

export interface SummaryParts {
  lastPrompt: string | null;
  aiTitle: string | null;
  lastResponse: string | null;
  userTurns: number;
  usage: SessionUsage;
  context: LatestTurnContext;
  toolNames: string[];
}

export function createSummaryScan() {
  // Whole-file folds, kept as running state.
  const usage: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  let userTurns = 0;
  let aiTitle: string | null = null;
  // Ring of the most recent records, for the end-of-session fields.
  const tail: Record<string, unknown>[] = [];

  return {
    add(record: Record<string, unknown>) {
      // One-record windows: each rule still decides for itself what counts, so "what is a user
      // turn" or "which usage fields exist" lives in one place, not two.
      const one = [record];
      userTurns += countUserTurnsFromParsed(one);
      const perRecord = sessionUsageFromParsed(one);
      usage.inputTokens += perRecord.inputTokens;
      usage.outputTokens += perRecord.outputTokens;
      usage.cacheReadTokens += perRecord.cacheReadTokens;
      usage.cacheCreationTokens += perRecord.cacheCreationTokens;
      aiTitle = aiTitleFromParsed(one) ?? aiTitle;

      tail.push(record);
      if (tail.length > TAIL_RECORDS) tail.shift();
    },

    finish(responseMax: number): SummaryParts {
      return {
        lastPrompt: latestMeaningfulUserPromptFromParsed(tail),
        aiTitle,
        lastResponse: latestAssistantTextFromParsed(tail)?.slice(0, responseMax) ?? null,
        userTurns,
        usage,
        context: latestTurnContextFromParsed(tail),
        toolNames: currentTurnToolNamesFromParsed(tail),
      };
    },
  };
}
