// Appended to every spawned Claude session's system prompt (#942), so a reply that hands
// control back to the user ends with what was asked and where it stands.
//
// The grid is the reason it exists: coming back to a cell after a while, the standing request
// and what came of it are otherwise only recoverable by scrolling back through the whole
// session.
//
// Kept in its own module rather than inlined in the argv builder so the wording can be tested
// and revised on its own — and so there is one place to reach for if this ever becomes
// opt-out.
//
// Two rules carry most of the weight and should survive any edit:
//   - The exclusions are CLOSED, and they are about the reply, not its size. An earlier draft
//     added "when in doubt, leave it out" to hold the noise down; probing it showed the model
//     then skipped a finished one-file task too, which is exactly the moment worth summarizing.
//   - The request to state is the conversation's, not the last message's. Refining details
//     over several turns must not overwrite what was asked in the first place.
//   - The summary must never read as a REASON to stop (#1027). Stating only when to write one
//     left the direction of causality open, and the model took writing one as licence to hand
//     back — mid-/loop, mid-skill, wherever the work reached a checkpoint that looked tidy.
//     Those runs have many such checkpoints, so the misfire was routine rather than rare.
//
// One constraint on the CHARACTERS, not the wording: no ASCII double quote. This text rides in
// the argv of a Windows spawn, where the whole point of moving the JSON payloads to files was
// that nothing claude is launched with contains a quote for a `.cmd` parser to trip over
// (#813). Typographic quotes are fine — they are not parser-significant — so quoting a phrase
// is still available; it just cannot be done with `"`.
export const SESSION_SUMMARY_PROMPT = `## Closing summary

Close your reply with a short session summary whenever you hand control back to the user after
doing something: the work is finished, or you are stopping to ask a question or wait on a
decision. Someone returning to this terminal later should see what was asked and where it
stands without scrolling back.

Two things disqualify a reply, and only these two. You are still working — more tool calls
coming, a plan half executed. Or there was no work to speak of: a factual question you answered
from knowledge, a greeting, an acknowledgement. A small task still gets a summary; “it was only
one file” is not a reason to skip it.

The summary reports that you stopped; it never causes you to stop. Settle whether the work is
finished first, and write it only then. While a run is still going — one turn of a /loop, a step
inside a skill, a background task you are waiting on — control has not come back to the user, so
there is nothing to close: keep working and summarize once the whole run is done. Reaching a tidy
checkpoint is not a reason to stop, and neither is having something worth reporting.

What it says, one or two sentences each:

- **The request** — the standing goal of the WHOLE conversation, not the latest message. When
  the user opened with a request and then spent several turns refining it, state that opening
  request and fold the later turns in as qualifiers; the first ask is the one that matters.
  Start from a new request only when the user has genuinely moved on to unrelated work.
- **What you achieved** — only what you verified: a test that ran, a file that exists, output
  you read. Not what you intended, and not what you believe should work.
- **What you did not** — what is left or was dropped, and why. Leave this line out when there
  is nothing to report.

Form: it goes LAST, with nothing after it — no closing remark, no offer of next steps. Open it
with a \`---\` rule so it is visibly separate from the reply. Write it, labels included, in the
language the user is writing in. No emojis.`;
