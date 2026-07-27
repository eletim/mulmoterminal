// @vitest-environment node
import { describe, it, expect } from "vitest";
import { activityHookEffects } from "../../../server/session/activity-hook";
import { nextActivity, sessionRow } from "../../../server/session/activity-transition";
import type { Activity } from "../../../server/session/types";
import { notifyKindOf, type ActivityState } from "../../../src/composables/notifyKind";
import type { NotifyKind } from "../../../common/notifyKinds";

// What the beep DOES, driven by what the server actually publishes.
//
// It lives under test/server/ despite testing a src/ module: notifyKind.ts is pure TypeScript
// with no DOM in it, so it runs under node, and importing the server's rules into the app's
// test project would pull @types/node into a browser program (which retypes window.setTimeout
// and breaks unrelated components).
//
// notifyKind.spec.ts checks the decision against rows written by hand, which is only ever as
// right as the author's memory of the server. This file removes that gap: it runs the real
// server rules (activityHookEffects deciding the flag changes, nextActivity deciding which of
// them publish at all) and feeds their output to the real client decision.
//
// It exists because of a regression that shipped past hand-written rows. A background Stop
// applies { waiting: true } then { working: false }; the second publishes NOTHING when the
// working flag was already false, and a decision keyed on that flag dropping made exactly
// those turns silent. The bug was invisible in a test that hand-wrote both rows, because the
// author wrote the row the server would not have sent.
//
// A turn that ends must make exactly ONE sound — never two (eight parallel sessions is what
// made #873 a problem in the first place) and never zero.

const SESSION = "s1";

/** Feed a hook through the server's rules and return the rows it would publish. */
function publish(state: { activity: Activity }, event: string, active: boolean): ReturnType<typeof sessionRow>[] {
  const rows: ReturnType<typeof sessionRow>[] = [];
  let clock = 1;
  for (const effect of activityHookEffects(event, active)) {
    const patch = effect.kind === "working" ? { working: effect.value } : { waiting: effect.value };
    const next = nextActivity(state.activity, patch, event, clock++);
    // Null is the server declining to publish — an unchanged flag never reaches a subscriber,
    // which is the whole trap this file exists for.
    if (!next) continue;
    state.activity = next;
    rows.push(sessionRow(SESSION, next, "/repo", {}));
  }
  return rows;
}

/** The kinds a run of hooks makes the client beep, in order. */
function kindsFor(hooks: { event: string; active: boolean }[], from: Activity = {}): NotifyKind[] {
  const state = { activity: from };
  const prev = new Map<string, ActivityState>();
  // Seed the baseline the same way a live page does: the client is already subscribed and has
  // seen this session before the turn starts.
  prev.set(SESSION, { working: from.working ?? false, waiting: from.waiting ?? false, event: from.event ?? null, announced: false });
  const kinds: NotifyKind[] = [];
  for (const hook of hooks) {
    for (const row of publish(state, hook.event, hook.active)) {
      const kind = notifyKindOf(prev, row);
      if (kind) kinds.push(kind);
    }
  }
  return kinds;
}

const turn = (active: boolean) => [
  { event: "UserPromptSubmit", active },
  { event: "PreToolUse", active },
  { event: "PostToolUse", active },
  { event: "Stop", active },
];

describe("what the server publishes, and what it makes the beep do", () => {
  it("beeps once for a turn finishing on a cell the user is NOT watching", () => {
    expect(kindsFor(turn(false))).toEqual(["finished"]);
  });

  it("beeps once for a turn finishing on the pane the user IS watching", () => {
    expect(kindsFor(turn(true))).toEqual(["finished"]);
  });

  // The regression. The working flag is what a turn's start sets; when it was never set — a
  // Stop arriving on a session the server does not currently believe is working — the second
  // row is never published and the first is all there is.
  it("beeps once for a Stop with no working flag to drop", () => {
    expect(kindsFor([{ event: "Stop", active: false }])).toEqual(["finished"]);
    expect(kindsFor([{ event: "Stop", active: false }], { working: false, waiting: false })).toEqual(["finished"]);
  });

  it("beeps once when a session blocks on input", () => {
    expect(
      kindsFor([
        { event: "UserPromptSubmit", active: false },
        { event: "Notification", active: false },
      ]),
    ).toEqual(["waiting"]);
  });

  it("beeps once per prompt, not once per repeated Notification", () => {
    const hooks = [
      { event: "UserPromptSubmit", active: false },
      { event: "Notification", active: false },
      { event: "Notification", active: false },
      { event: "Notification", active: false },
    ];
    expect(kindsFor(hooks)).toEqual(["waiting"]);
  });

  it("says nothing at all while a turn is merely running", () => {
    const hooks = [
      { event: "UserPromptSubmit", active: false },
      { event: "PreToolUse", active: false },
      { event: "PostToolUse", active: false },
      { event: "PostToolUseFailure", active: false },
    ];
    expect(kindsFor(hooks)).toEqual([]);
  });

  // A blocked turn the user answers, which then finishes: they are told twice because those
  // are two different moments, and the kinds differ so the two sounds do too.
  it("distinguishes the block from the finish in one turn", () => {
    const hooks = [
      { event: "UserPromptSubmit", active: false },
      { event: "Notification", active: false },
      { event: "PostToolUse", active: false },
      { event: "Stop", active: false },
    ];
    expect(kindsFor(hooks)).toEqual(["waiting", "finished"]);
  });

  it("never reports a finished turn as waiting, whichever cell it is on", () => {
    for (const active of [true, false]) expect(kindsFor(turn(active))).not.toContain("waiting");
  });

  // The property the regression broke, stated directly so a future change to activityHookEffects
  // cannot quietly take the sound away again: whenever a Stop publishes ANYTHING, it is heard
  // exactly once — never twice from its two rows, never zero because only one of them arrived.
  //
  // "Whenever it publishes anything" is the honest bound, not a hedge. A Stop on the pane the
  // user is watching applies only { working: false }, and an unchanged flag publishes nothing —
  // so a Stop there with no working flag set produces NO row at all, and no client decision can
  // recover a sound from it. That gap is the server's; it is asserted below rather than left
  // implicit, so a change that closes it shows up here.
  const RUNS = [
    ["a full turn", (active: boolean) => turn(active)],
    [
      "a turn with no tool calls",
      (active: boolean) => [
        { event: "UserPromptSubmit", active },
        { event: "Stop", active },
      ],
    ],
    ["a bare Stop", (active: boolean) => [{ event: "Stop", active }]],
    [
      "a turn that asked first",
      (active: boolean) => [
        { event: "UserPromptSubmit", active },
        { event: "Notification", active },
        { event: "Stop", active },
      ],
    ],
  ] as const;

  it.each([
    ["watched cell", true],
    ["background cell", false],
  ])("sounds a finish exactly once per published Stop on a %s", (_label, active) => {
    for (const [label, build] of RUNS) {
      const hooks = build(active);
      const published = kindsFor(hooks);
      // Did the server emit a row for the Stop at all?
      const state = { activity: {} as Activity };
      hooks.slice(0, -1).forEach((h) => publish(state, h.event, h.active));
      const stopRows = publish(state, "Stop", active);
      const expected = stopRows.length ? 1 : 0;
      expect({ run: label, finishes: published.filter((k) => k === "finished").length }).toEqual({ run: label, finishes: expected });
    }
  });

  it("is the WATCHED pane, and only it, that can swallow a bare Stop", () => {
    expect(publish({ activity: {} }, "Stop", true)).toHaveLength(0);
    expect(publish({ activity: {} }, "Stop", false)).not.toHaveLength(0);
  });
});
