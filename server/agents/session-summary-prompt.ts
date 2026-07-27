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
// It must contain NO `"`. On Windows a `.cmd`-installed Claude is launched through cmd.exe,
// where the command line is parsed by cmd and then by the child's CRT, and the two disagree
// about quoting — which is why the JSON payloads travel as files (#813). This is prose, so the
// temptation is to quote a phrase inside it; that would put the only quote back into the argv.
//
// Two rules carry most of the weight and should survive any edit:
//   - The exclusions are CLOSED, and they are about the reply, not its size. An earlier draft
//     added "when in doubt, leave it out" to hold the noise down; probing it showed the model
//     then skipped a finished one-file task too, which is exactly the moment worth summarizing.
//   - The request to state is the conversation's, not the last message's. Refining details
//     over several turns must not overwrite what was asked in the first place.
export const SESSION_SUMMARY_PROMPT = `## Closing summary

Close your reply with a short session summary whenever you hand control back to the user after
doing something: the work is finished, or you are stopping to ask a question or wait on a
decision. Someone returning to this terminal later should see what was asked and where it
stands without scrolling back.

Two things disqualify a reply, and only these two. You are still working — more tool calls
coming, a plan half executed. Or there was no work to speak of: a factual question you answered
from knowledge, a greeting, an acknowledgement. A small task still gets a summary; being only
one file is not a reason to skip it.

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
