import type { PushKind } from "../../common/pushKinds.js";

// Pure decision for a Claude activity hook (UserPromptSubmit / Stop / Notification).
//
// `active` = this session is the user's actively-viewed pane: the single-view open
// session, or a focused/zoomed grid cell. An active pane never raises the attention
// flag (the user is already looking at it). A grid cell the user is NOT focused on is
// inactive even though its socket is attached, so it can surface `blocked` (Notification)
// or `done` (Stop) among its siblings — the whole point of the parallel grid.
//
// Extracted from index.ts so the grid attention semantics are unit-testable; the
// caller applies the effects via setWorking/setWaiting, which only publish UI activity.

export type ActivityEffect = { kind: "working" | "waiting"; value: boolean };

// A prompt starts a turn and a tool call is the middle of one — both mean the session is
// working right now. Tool events matter beyond the obvious: `working` is set once at
// UserPromptSubmit and cleared at Stop, so across a long turn nothing re-asserts it. If it
// is ever lost mid-turn (a --watch restart between the prompt and the Stop), the session
// reads idle until it finally stops — unless each tool call puts `working` back. nextActivity
// no-ops when the flag is already true, so this re-asserts only after a loss, never spams.
const WORKING_EVENTS = new Set(["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure"]);

// Notification types that report something that ALREADY HAPPENED rather than something the user
// must answer. `agent_completed` is the one this was written for: a subagent finishing fires it,
// and treating every Notification as "blocked on you" made a finished subagent flag the cell for
// attention, beep, and push — once per subagent, while the main turn was still running (#874).
// Measured, not assumed: the payload carries `notification_type: "agent_completed"` and no
// `agent_id`, so the TYPE is the only thing that distinguishes it.
//
// A DENYLIST, not an allowlist, and the asymmetry is the reason: Claude Code adds notification
// types over time, an unrecognised one still notifies, and the two failure modes are not equal.
// One spurious ping is an annoyance; a swallowed "your agent is blocked" is exactly what this
// feature exists to prevent, and a user cannot discover a stuck session any other way.
const INFORMATIONAL_NOTIFICATIONS: ReadonlySet<string> = new Set(["agent_completed", "auth_success", "elicitation_complete", "elicitation_response"]);

// A Notification the user should actually be told about. An absent type means an older Claude
// Code that doesn't send one — those keep the previous behaviour rather than going silent.
export function isActionableNotification(notificationType?: string): boolean {
  return !notificationType || !INFORMATIONAL_NOTIFICATIONS.has(notificationType);
}

export function activityHookEffects(event: string, active: boolean, notificationType?: string): ActivityEffect[] {
  if (WORKING_EVENTS.has(event)) return [{ kind: "working", value: true }];
  // A finished turn (Stop) has unseen output; a paused turn (Notification) waits on the
  // user. Either flags the session for attention UNLESS it's the actively-viewed pane.
  if (event === "Stop") {
    return active
      ? [{ kind: "working", value: false }]
      : [
          { kind: "waiting", value: true },
          { kind: "working", value: false },
        ];
  }
  if (event === "Notification") return active || !isActionableNotification(notificationType) ? [] : [{ kind: "waiting", value: true }];
  return [];
}

// Which kind of Web Push a hook warrants, or null for none. Two events reach the
// phone, and they mean different things to a user glancing at a lock screen:
//   - "finished"  (Stop):         the turn ended, output is waiting to be reviewed.
//   - "waiting"   (Notification): the agent is blocked on input — a permission
//                                 prompt or a question — and answering it from the
//                                 phone actually unblocks work.
// Only "finished" fired before; "waiting" is the one the user is most likely to want
// (they cannot know a session is stuck otherwise). Unlike the attention beep, both
// fire regardless of `active` — the phone is elsewhere. hidden /
// translation gates stay with the caller.

export function pushKindFor(event: string, notificationType?: string): PushKind | null {
  if (event === "Stop") return "finished";
  if (event === "Notification") return isActionableNotification(notificationType) ? "waiting" : null;
  return null;
}

// The push title/body for a kind. Pure so the wording is unit-testable without a PTY.
//   finished: "\u2705 <dir>"        body = the prompt/title, or a done fallback
//   waiting:  "\u2753 <dir>"        body = the hook's message (e.g. a permission ask), or a fallback
// `where` is the working-dir basename; `detail` is the session's prompt/title;
// `message` is the Notification hook's own text (empty for a finished turn).
export interface PushText {
  title: string;
  body: string;
}

const clip = (text: string, max: number): string => text.slice(0, max);

// A push body renders as one run of text, but the finished-turn body is now the agent's
// reply — markdown with newlines and indentation. Collapsed, the first 160 characters are
// a sentence; left alone they are ragged fragments with the useful part pushed off the end.
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

// Replace "[text](url)" with "text", scanning rather than matching — the obvious regex
// backtracks (lint bans those, as in the scheduler's time parsing). An unclosed "[" ends
// the scan and the remainder is kept verbatim.
const flattenLinks = (text: string): string => {
  const parts: string[] = [];
  let rest = 0;
  for (let open = text.indexOf("["); open !== -1; open = text.indexOf("[", rest)) {
    const label = text.indexOf("](", open);
    const close = label === -1 ? -1 : text.indexOf(")", label + 2);
    if (close === -1) break;
    parts.push(text.slice(rest, open), text.slice(open + 1, label));
    rest = close + 1;
  }
  parts.push(text.slice(rest));
  return parts.join("");
};

// A lock screen renders no markdown: emphasis arrives as literal asterisks, and a link's
// target spends a third of the 160-character budget on something the user cannot click
// from the text. Heading markers are left alone — "#" also starts an issue number.
const plainText = (text: string): string => flattenLinks(text).replace(/\*\*/g, "");

export function buildPushText(kind: PushKind, where: string, detail: string, message: string, limits: { title: number; body: number }): PushText {
  if (kind === "waiting") {
    return {
      title: clip(`\u2753 ${where}`, limits.title),
      body: clip(oneLine(plainText(message)) || oneLine(plainText(detail)) || "\u5165\u529b\u5f85\u3061\u3067\u3059", limits.body),
    };
  }
  return {
    title: clip(`\u2705 ${where}`, limits.title),
    body: clip(oneLine(plainText(detail)) || "\u30bf\u30b9\u30af\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f", limits.body),
  };
}

// Which session a hook belongs to, or null when neither source names one usably.
//
// The `x-mt-session` header wins: Claude reissues its own session_id on /clear and
// /compact, while the mulmoterminal id is the one hooks must stay attributed to.
//
// BOTH sources are validated against the same UUID shape. The id travels to the phone as push
// routing, and the rest of the codebase already treats a SESSION_ID_RE match as the precondition
// for using an id as a filename, so the fallback has no business being the one place that skips it.
export function resolveHookSessionId(header: unknown, bodyValue: unknown, isValidId: (id: string) => boolean): string | null {
  const usable = (value: unknown): string | null => (typeof value === "string" && isValidId(value) ? value : null);
  return usable(header) ?? usable(bodyValue);
}

// Which directory a hook's relative paths resolve against. The CLI reports its live cwd in
// the payload, but the PTY table only holds the dir the session was SPAWNED in — that value
// goes stale the moment the session `cd`s. So the payload cwd wins, falling back to the spawn
// dir only when the hook carries none. Shared by every hook path so they can't disagree on
// which directory a relative write (e.g. a `.mulmoterminal.json` live-reload) belongs to.
export function resolveHookCwd(bodyCwd: unknown, spawnCwd: string | undefined): string | undefined {
  return typeof bodyCwd === "string" ? bodyCwd : spawnCwd;
}
