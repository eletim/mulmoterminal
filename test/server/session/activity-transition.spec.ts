// @vitest-environment node
import { describe, it, expect } from "vitest";
import { nextActivity, normalizeActivity, sessionRow, shouldRefreshReply } from "../../../server/session/activity-transition.js";

const NOW = 1_700_000_000_000;

describe("nextActivity", () => {
  describe("no-op detection", () => {
    it("reports no change when the flag already holds that value", () => {
      // Every hook calls a setter; without this an idle session would republish its row
      // on each one, waking every subscribed client for nothing.
      expect(nextActivity({ working: true }, { working: true }, undefined, NOW)).toBeNull();
      expect(nextActivity({ waiting: false }, { waiting: false }, undefined, NOW)).toBeNull();
    });

    it("treats an absent flag as false, so clearing an unset one is a no-op", () => {
      expect(nextActivity({}, { working: false }, undefined, NOW)).toBeNull();
      expect(nextActivity(undefined, { waiting: false }, undefined, NOW)).toBeNull();
      expect(nextActivity({ waiting: true }, { working: false }, undefined, NOW)).toBeNull();
    });

    it("reports a change even when only the event would differ", () => {
      // The flag is what decides; an event alone must not trigger a write.
      expect(nextActivity({ working: true, event: "A" }, { working: true }, "B", NOW)).toBeNull();
    });
  });

  describe("setting a flag", () => {
    it("records the new value and the time", () => {
      expect(nextActivity(undefined, { working: true }, "UserPromptSubmit", NOW)).toEqual({
        working: true,
        event: "UserPromptSubmit",
        at: NOW,
      });
    });

    it("keeps the other flag untouched", () => {
      expect(nextActivity({ working: true, waiting: true, event: "Stop", at: 1 }, { working: false }, undefined, NOW)).toEqual({
        working: false,
        waiting: true,
        event: "Stop",
        at: NOW,
      });
    });

    it("clears a set flag", () => {
      expect(nextActivity({ waiting: true, event: "Notification", at: 1 }, { waiting: false }, undefined, NOW)).toEqual({
        waiting: false,
        event: "Notification",
        at: NOW,
      });
    });

    it("always advances `at`, so the record reflects this change", () => {
      expect(nextActivity({ working: false, at: 1 }, { working: true }, undefined, NOW)?.at).toBe(NOW);
    });
  });

  describe("event label", () => {
    it("takes the event it was given", () => {
      expect(nextActivity({ event: "Stop" }, { working: true }, "UserPromptSubmit", NOW)?.event).toBe("UserPromptSubmit");
    });

    it("keeps the previous event when none is given", () => {
      // A change carrying no event must not blank a row that was labelled "Notification" —
      // the label is what the UI shows for why the session wants attention.
      expect(nextActivity({ waiting: true, event: "Notification" }, { working: true }, undefined, NOW)?.event).toBe("Notification");
    });

    it("is null when neither the change nor the previous record has one", () => {
      expect(nextActivity(undefined, { working: true }, undefined, NOW)?.event).toBeNull();
      expect(nextActivity({ event: null }, { working: true }, undefined, NOW)?.event).toBeNull();
    });

    it("prefers an explicit empty event over the previous one", () => {
      // "" is a given value, not an absent one — `??` only falls through on null/undefined.
      expect(nextActivity({ event: "Stop" }, { working: true }, "", NOW)?.event).toBe("");
    });
  });

  it("does not mutate the record it was given", () => {
    const prev = { working: false, event: "Stop", at: 1 };
    nextActivity(prev, { working: true }, "UserPromptSubmit", NOW);
    expect(prev).toEqual({ working: false, event: "Stop", at: 1 });
  });

  it("drives both setters identically apart from which flag moves", () => {
    const prev = { event: "Stop", at: 1 };
    expect(nextActivity(prev, { working: true }, undefined, NOW)).toEqual({ working: true, event: "Stop", at: NOW });
    expect(nextActivity(prev, { waiting: true }, undefined, NOW)).toEqual({ waiting: true, event: "Stop", at: NOW });
  });
});

// The activity fields are always complete. Core-owned metadata is optional: absence means
// "no metadata update", so an activity event cannot clear a title or memo it does not own.
describe("sessionRow", () => {
  it("fills every field for a session with no activity yet", () => {
    expect(sessionRow("S", undefined, null, {})).toEqual({
      id: "S",
      cwd: null,
      working: false,
      waiting: false,
      event: null,
      lastPrompt: null,
      lastResponse: null,
    });
  });

  it("carries the activity flags and label through", () => {
    const row = sessionRow("S", { working: true, waiting: true, event: "Stop", at: 1 }, "/ws", {});
    expect(row).toMatchObject({ working: true, waiting: true, event: "Stop", cwd: "/ws" });
  });

  it("does not leak `at` — it is bookkeeping, not part of the row", () => {
    expect(Object.keys(sessionRow("S", { working: true, at: 999 }, null, {}))).not.toContain("at");
  });

  it("carries activity-owned texts without inventing Core metadata", () => {
    expect(sessionRow("S", undefined, null, { lastPrompt: "p", lastResponse: "r" })).toMatchObject({
      lastPrompt: "p",
      lastResponse: "r",
    });
    expect(sessionRow("S", undefined, null, { lastPrompt: "p", lastResponse: "r" })).not.toHaveProperty("aiTitle");
  });

  it("keeps an empty text as empty rather than turning it into null", () => {
    // `/clear` blanks the prompt deliberately: "" beats the transcript fallback the
    // reader applies, while null would let the pre-clear prompt resurface.
    expect(sessionRow("S", undefined, null, { lastPrompt: "", lastResponse: "" })).toMatchObject({
      lastPrompt: "",
      lastResponse: "",
    });
  });

  it("carries an explicit memo but omits it when the activity producer has no metadata update", () => {
    expect(sessionRow("S", undefined, null, { memo: "release check" }).memo).toBe("release check");
    expect(sessionRow("S", undefined, null, {})).not.toHaveProperty("memo");
  });

  it("keeps a null cwd when no Core metadata is available", () => {
    expect(sessionRow("S", { working: true }, null, {}).cwd).toBeNull();
  });
});

// The working/waiting/event triple sessionRow spreads in — pinned on its own since the local
// mobile route (local-mobile-terminal-routes.ts) reads it directly for a session's `activity`
// field, without building a full SessionRow.
describe("normalizeActivity", () => {
  it("defaults every field for a session with no activity record", () => {
    expect(normalizeActivity(undefined)).toEqual({ working: false, waiting: false, event: null });
  });

  it("defaults only the fields the record omits", () => {
    expect(normalizeActivity({ working: true })).toEqual({ working: true, waiting: false, event: null });
  });

  it("carries a set flag and its event through unchanged", () => {
    expect(normalizeActivity({ working: true, waiting: true, event: "Stop", at: 1 })).toEqual({ working: true, waiting: true, event: "Stop" });
  });

  it("drops `at` — bookkeeping, not part of the triple", () => {
    expect(Object.keys(normalizeActivity({ working: true, at: 999 }))).not.toContain("at");
  });
});

describe("shouldRefreshReply", () => {
  it("refreshes when a turn just ended and there is a transcript to read", () => {
    expect(shouldRefreshReply({ waiting: true }, "/ws", false)).toBe(true);
  });

  it("does not refresh a session that is not waiting", () => {
    // Re-reading on every publish would put a file read in the path of each hook.
    expect(shouldRefreshReply({ working: true }, "/ws", false)).toBe(false);
    expect(shouldRefreshReply({ waiting: false }, "/ws", false)).toBe(false);
    expect(shouldRefreshReply({}, "/ws", false)).toBe(false);
    expect(shouldRefreshReply(undefined, "/ws", false)).toBe(false);
  });

  it("does not refresh without a cwd — there is no transcript to read", () => {
    expect(shouldRefreshReply({ waiting: true }, null, false)).toBe(false);
    expect(shouldRefreshReply({ waiting: true }, "", false)).toBe(false);
  });

  it("does not refresh a cleared session — its transcript is the conversation the user ended", () => {
    // The turn that ends AFTER a /clear is the one that used to put the pre-clear reply back
    // into the roster (#1085): waiting is true and the cwd is right, so only this says no.
    expect(shouldRefreshReply({ waiting: true }, "/ws", true)).toBe(false);
  });
});
