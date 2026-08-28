// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/session/session-reads.js", () => ({
  readSessionSummary: vi.fn(async () => ({
    lastPrompt: "transcript prompt",
    lastResponse: "transcript response",
    userTurns: ["turn"],
    usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40 },
    context: { model: "claude-opus-4-8", contextTokens: 50 },
    workPhase: "planning",
  })),
}));

import { activity, lastPrompts, lastResponses } from "../../../server/session/activity-store.js";
import { readSessionState } from "../../../server/session/session-state.js";

const ID = "11111111-2222-4333-8444-555555555555";

describe("readSessionState", () => {
  beforeEach(() => {
    activity.clear();
    lastPrompts.clear();
    lastResponses.clear();
  });

  it("assembles one snapshot from Core, live activity and transcript-derived state without owning a registry", async () => {
    activity.set(ID, { working: true, waiting: false, event: "PreToolUse", at: 1 });
    lastPrompts.set(ID, "live prompt");
    lastResponses.set(ID, "live response");

    const { state, userTurns } = await readSessionState(ID, "/work", {
      getCoreSession: vi.fn(async () => ({ id: ID, cwd: "/work", title: "AI title", memo: "memo", exited: false }) as never),
      workPhaseOf: () => "implementing",
    });

    expect(state).toEqual({
      id: ID,
      cwd: "/work",
      working: true,
      waiting: false,
      event: "PreToolUse",
      lastPrompt: "live prompt",
      lastResponse: "live response",
      aiTitle: "AI title",
      memo: "memo",
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40 },
      context: { model: "claude-opus-4-8", contextTokens: 50 },
      workPhase: "implementing",
      exited: false,
    });
    expect(userTurns).toEqual(["turn"]);
  });

  it("terminalizes activity and phase for an exited Core session", async () => {
    activity.set(ID, { working: true, waiting: true, event: "Notification", at: 1 });
    const { state } = await readSessionState(ID, "/work", {
      getCoreSession: vi.fn(async () => ({ id: ID, cwd: "/work", title: null, memo: null, exited: true }) as never),
      workPhaseOf: () => "implementing",
    });

    expect(state).toMatchObject({ working: false, waiting: false, event: null, workPhase: null, exited: true });
  });
});
