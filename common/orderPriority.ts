// A directory's rank in the grid's "priority" sort order. Shared so the two boundaries that
// validate it — the server reading .mulmoterminal.json, and the client reading /api/dir-config —
// cannot disagree about what counts as a rank. They did briefly: one accepted any finite number
// while the other required an integer, so a fractional value would have sorted on one side and
// read as unset on the other.
//
// Integers only: a rank is an ordering, so 1.5 buys nothing and invites float-comparison
// surprises. Not range-limited, unlike a font size — every integer is a usable rank, and
// negatives are how a project sorts ahead of everything at 0.
//
// SAFE integers, because the strict half of the pair is `z.number().int()` and zod@4 reads that
// as safe-only. `Number.isInteger` alone accepts 2^53+1 and 1e300, which this would have taken
// while writableDirConfigSchema rejected them — the exact disagreement the paragraph above says
// this module exists to prevent, one boundary over. Past 2^53 an integer is not distinct from its
// neighbours anyway, so it cannot express a rank.
//
// null means "unset", which the sort reads as "after everything that declares a rank".
export function normalizeOrderPriority(input: unknown): number | null {
  return typeof input === "number" && Number.isSafeInteger(input) ? input : null;
}
