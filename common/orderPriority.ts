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
// null means "unset", which the sort reads as "after everything that declares a rank".
export function normalizeOrderPriority(input: unknown): number | null {
  return typeof input === "number" && Number.isInteger(input) ? input : null;
}
