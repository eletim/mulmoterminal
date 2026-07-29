// How a live activity push updates what a grid cell shows, and what the header says.
//
// Two different treatments of "absent", and the difference is the whole rule:
//
//   working / waiting — absent means FALSE. A push that omits them is saying the session is
//   not doing that; defaulting to the previous value would leave a finished session pulsing.
//
//   lastPrompt / aiTitle / memo — absent means "no news, keep what is shown", but an explicit
//   NULL means "there is none now". Collapse the two and a cleared or restarted session keeps
//   displaying the prompt and title from the conversation the user just ended — and an erased
//   memo comes back on the next push.

export interface ActivityPush {
  working?: boolean;
  waiting?: boolean;
  event?: string | null;
  lastPrompt?: string | null;
  aiTitle?: string | null;
  memo?: string | null;
}

export interface CellActivityState {
  working: boolean;
  waiting: boolean;
  event: string | null;
  lastPrompt: string | null;
  aiTitle: string | null;
  memo: string | null;
}

export function applyActivityPush(previous: CellActivityState, push: ActivityPush): CellActivityState {
  return {
    working: push.working ?? false,
    waiting: push.waiting ?? false,
    event: push.event !== undefined ? push.event : previous.event,
    lastPrompt: push.lastPrompt !== undefined ? push.lastPrompt : previous.lastPrompt,
    aiTitle: push.aiTitle !== undefined ? push.aiTitle : previous.aiTitle,
    memo: push.memo !== undefined ? push.memo : previous.memo,
  };
}

// What the cell header shows for a session: the user's own note, else our summary, else the last
// prompt, else enough of the id to tell two cells apart, else a session that has not reported
// anything yet.
//
// The memo wins because it is the only tier the USER wrote — everything below it describes what
// the agent said, which is exactly what stops answering "which cell is this" once six are open
// (#1084). Same precedence server-side in sessionListTitle.ts, so one session cannot go by two
// names depending on where it is looked at.
//
// `||` rather than `??` on purpose — an empty memo, title or prompt is nothing to show, not a value.
export function cellHeaderText(memo: string | null, aiTitle: string | null, lastPrompt: string | null, sessionId: string | null): string {
  return memo || aiTitle || lastPrompt || (sessionId ? sessionId.slice(0, 8) : "starting…");
}
