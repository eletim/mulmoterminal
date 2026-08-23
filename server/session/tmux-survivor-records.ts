import type { SessionAgent } from "../../common/sessionAgent.js";
import { agentFromPaneCommand } from "../mobileTerminal/terminalScreen.js";
import type { AntigravityConversationRecordSource, TmuxSurvivorSessionRecordSource } from "./session-records.js";

export interface TmuxSurvivorRecordHydrationInput {
  tmuxIds: readonly string[];
  liveIds?: ReadonlySet<string>;
  cwdBySession?: ReadonlyMap<string, string>;
  titleBySession?: ReadonlyMap<string, string>;
  antigravityConversations?: readonly AntigravityConversationRecordSource[];
  paneCommandOf?: (id: string) => string | null;
  now?: number;
}

function antigravityBySession(records: readonly AntigravityConversationRecordSource[] | undefined): Map<string, AntigravityConversationRecordSource> {
  return new Map((records ?? []).map((record) => [record.sessionId, record]));
}

function paneAgent(id: string, paneCommandOf: TmuxSurvivorRecordHydrationInput["paneCommandOf"]): SessionAgent | null {
  return agentFromPaneCommand(paneCommandOf?.(id) ?? null);
}

export function hydrateTmuxSurvivorRecordSources(input: TmuxSurvivorRecordHydrationInput): TmuxSurvivorSessionRecordSource[] {
  const now = input.now ?? Date.now();
  const liveIds = input.liveIds ?? new Set<string>();
  const antigravity = antigravityBySession(input.antigravityConversations);
  return [...new Set(input.tmuxIds)]
    .filter((id) => !liveIds.has(id))
    .map((id) => {
      const agy = antigravity.get(id);
      return {
        id,
        agent: paneAgent(id, input.paneCommandOf),
        cwd: input.cwdBySession?.get(id) ?? agy?.cwd ?? null,
        title: input.titleBySession?.get(id) ?? null,
        createdAt: agy?.startedAt ?? null,
        updatedAt: now,
      };
    });
}
