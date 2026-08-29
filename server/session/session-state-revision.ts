// Ordering metadata for the two transports that carry one derived session view. This is not a
// session-state store: Core/activity/transcripts remain authoritative, and only a counter is kept.
const revisions = new Map<string, number>();

export const currentSessionStateRevision = (id: string): number => revisions.get(id) ?? 0;

export function versionSessionStateUpdate<T extends Record<string, unknown>>(id: string, update: T): T & { revision: number } {
  const revision = currentSessionStateRevision(id) + 1;
  revisions.set(id, revision);
  return { ...update, revision };
}
