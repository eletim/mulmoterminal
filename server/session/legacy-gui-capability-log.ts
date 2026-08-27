// Parser used only by the one-way Core capability migration. Current code never writes this
// Backend log; live GUI capability is Core metadata.
import { isToolGroup, type ToolGroup } from "../../common/toolGroups.js";

export interface LegacySessionToolGroup {
  sessionId: string;
  group: ToolGroup;
}

type Entry = { sessionId: string; group: ToolGroup | null };

function entryFromLine(line: string, isValidId: (id: string) => boolean): Entry[] {
  const [sessionId, group, ...rest] = line.trim().split(/\s+/);
  if (rest.length > 0 || !sessionId || !isValidId(sessionId)) return [];
  if (group === "-") return [{ sessionId, group: null }];
  return isToolGroup(group) ? [{ sessionId, group }] : [];
}

export function parseLegacySessionToolGroups(contents: string, isValidId: (id: string) => boolean): LegacySessionToolGroup[] {
  const bySession = new Map<string, Set<ToolGroup>>();
  for (const line of contents.split("\n")) {
    for (const { sessionId, group } of entryFromLine(line, isValidId)) {
      if (group === null) {
        bySession.set(sessionId, new Set());
        continue;
      }
      const groups = bySession.get(sessionId) ?? new Set<ToolGroup>();
      groups.add(group);
      bySession.set(sessionId, groups);
    }
  }
  return [...bySession].flatMap(([sessionId, groups]) => [...groups].map((group) => ({ sessionId, group })));
}
