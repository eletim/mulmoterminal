// Building a session's summary from a stream of records instead of an array of them.
//
// `readSessionSummary` produced all seven fields in one pass over `parseJsonl(readFile(...))`,
// which is the pass that cannot run at all on a transcript past ~512 MB (#998). Each field was
// already a fold over the records — the only thing holding them together was the array.
//
// **No windows.** The first draft kept a tail of the last N records and read the "what happened
// recently" fields off it. That is wrong, and Codex caught the first instance: a turn has no
// bound — measured across the eight largest transcripts on this machine, the longest spans 3,615
// records — so a window silently drops a turn's early tool calls, then its prompt, then the reply
// and model that preceded a long run of tool results. Every field here therefore folds over every
// record, keeping only what it needs:
//
//   - counts and totals → running numbers
//   - "the newest X"    → the last X seen, replaced as it arrives
//   - the current turn  → reset on each user prompt (the rule already works that way)
//
// The per-record memory is a handful of strings and one array that empties every turn, so a
// 585 MB transcript costs the same as a small one.
//
// Every rule still lives in its `…FromParsed` function: each is fed a one-record or few-record
// window rather than reimplemented here.
import {
  aiTitleFromParsed,
  countUserTurnsFromParsed,
  createCurrentTurnToolScan,
  latestAssistantTextFromParsed,
  latestMeaningfulUserPromptFromParsed,
  latestTurnContextFromParsed,
  sessionUsageFromParsed,
} from "./transcript.js";
import type { LatestTurnContext, SessionUsage } from "./transcript.js";

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
  const usage: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  let userTurns = 0;
  let aiTitle: string | null = null;
  const toolScan = createCurrentTurnToolScan();
  // User records only — `latestMeaningfulUserPrompt` walks back for the newest NON-trivial one, so
  // it needs them all, and a session has far fewer user turns than records.
  const userRecords: Record<string, unknown>[] = [];
  // Whatever produced these most recently, so a long run of tool calls afterwards cannot bury them.
  let lastAssistantText: string | null = null;
  let lastContext: LatestTurnContext | null = null;

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
      toolScan.add(record);
      if (record.type === "user") userRecords.push(record);
      // `?? previous` rather than an unconditional assign: an assistant record carrying only a
      // tool_use has no text, and must not blank out the reply the user is looking at.
      lastAssistantText = latestAssistantTextFromParsed(one) ?? lastAssistantText;
      const context = latestTurnContextFromParsed(one);
      if (context.model !== null) lastContext = context;
    },

    finish(responseMax: number): SummaryParts {
      return {
        lastPrompt: latestMeaningfulUserPromptFromParsed(userRecords),
        aiTitle,
        lastResponse: lastAssistantText?.slice(0, responseMax) ?? null,
        userTurns,
        usage,
        context: lastContext ?? latestTurnContextFromParsed([]),
        toolNames: toolScan.names(),
      };
    },
  };
}
