// Collapse the Canvas feed so a thing that was drawn twice appears once.
//
// Re-presenting one file-backed artifact over several turns creates separate tool results, so the
// panel would otherwise grow a fresh card per update and push the current one off the bottom. The
// results are not duplicates in the store (they are a real history, and the server keeps them);
// they are duplicates ON SCREEN, because all but the last render stale state.
//
// The rule: results sharing an identity collapse to the LAST one, placed at the last one's
// position. A result whose identity is null never collapses — that is the default, so a tool
// that has not opted in behaves exactly as before.
//
// DELIBERATE DIVERGENCE from MulmoClaude. Its equivalent (`buildStackDisplayItems` in
// ../mulmoclaude/src/utils/canvas/stackGrouping.ts) keeps the merged card at the group's FIRST
// occurrence and retains every member for its sidebar to select. Both differences are on purpose:
//   - Position: MulmoClaude has a sidebar listing every result, so "latest" is reachable without
//     the stack order saying anything. MulmoTerminal has no such list — the bottom of the pane is
//     the only affordance that means "newest", so a re-drawn card has to move there or the
//     auto-follow below scrolls to something that did not change.
//   - Members: this drops the superseded results instead of keeping them under a `members[]`,
//     because nothing here can select one. They remain in the server's store either way.
// Owner's call, on the feedback that prompted this (see the PR).

/**
 * Keep the last result per identity, at that last result's position.
 *
 * `identityOf` returns null for anything that should stand alone — inline content with no backing
 * file, a tool with no notion of "the same thing again", or a shape the accessor did not
 * recognise. Callers must namespace the identity by tool, so two tools with the same path-shaped
 * identity cannot collide.
 */
export function collapseByIdentity<T>(results: readonly T[], identityOf: (result: T) => string | null): T[] {
  // Backwards, keeping the first sighting of each identity — which is the LAST in reading order —
  // then reversed. One pass, and the survivors come out in the order their kept occurrence had.
  const seen = new Set<string>();
  const kept: T[] = [];
  for (let i = results.length - 1; i >= 0; i--) {
    const result = results[i];
    if (result === undefined) continue;
    const identity = identityOf(result);
    if (identity !== null) {
      if (seen.has(identity)) continue;
      seen.add(identity);
    }
    kept.push(result);
  }
  return kept.reverse();
}
