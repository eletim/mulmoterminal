// The kinds of Web Push a session can raise. The server decides which one a hook warrants and
// the settings UI offers them as checkboxes, so the list is a value both sides read.

// Every kind that exists.
//   finished — the turn ended, output is waiting to be reviewed.
//   waiting  — the agent is blocked on input (a permission prompt or a question), so answering
//              from the phone unblocks real work. Fires once per prompt, which on a long task
//              that asks repeatedly is what makes pushes feel frequent (#850).
export const PUSH_KINDS = ["finished", "waiting"] as const;

export type PushKind = (typeof PUSH_KINDS)[number];

// What a config with no `pushKinds` gets. Deliberately a SEPARATE list from PUSH_KINDS, not a
// copy of it: a kind added later must NOT start notifying people who never asked for it.
//
// That is exactly how this setting came to be needed — `waiting` was added in 36e9e72 and
// every user with push on began receiving it, with no way to decline. Add a new kind to
// PUSH_KINDS so it can be switched on, and leave it out of here so it stays opt-in.
export const DEFAULT_PUSH_KINDS: PushKind[] = ["finished", "waiting"];

export const isPushKind = (value: unknown): value is PushKind => PUSH_KINDS.some((kind) => kind === value);
