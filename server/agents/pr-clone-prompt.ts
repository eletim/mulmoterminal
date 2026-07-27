// Appended to a spawned session's system prompt so a PR the AGENT opens says which clone it
// came from — the same line the ⧉ Open PR button appends (server/git/pr-footer.ts, #872).
//
// That button was the only path that ever added it, and in practice almost every PR here is
// opened by an agent running `gh pr create`, so the line was missing from nearly all of them.
//
// The clone NAME is resolved by the server and pasted into the text, rather than asking the
// agent to work it out: `repoRoot()` already answers with the main checkout even from inside a
// managed worktree, which is exactly the case an agent would get wrong (it would report the
// worktree, and the branch is already on the PR).
//
// Same character constraint as session-summary-prompt.ts: NO ASCII double quote. This text
// rides in the argv of a Windows spawn (#813).

export function prClonePrompt(footer: string): string {
  return `## Which clone this work is in

When you open a pull request for this repository — with gh, the API, or any other tool — end the
body with this line, on its own:

${footer}

Several checkouts of one repository run side by side here, and a PR on GitHub otherwise carries
nothing that says which one produced it. Take the line exactly as given above; do not derive the
name from the branch, the path, or the working directory. Add it once — if the body already ends
with that line, leave it as it is.`;
}
