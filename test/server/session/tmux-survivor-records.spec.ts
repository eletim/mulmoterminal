// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hydrateTmuxSurvivorRecordSources } from "../../../server/session/tmux-survivor-records.js";

describe("hydrateTmuxSurvivorRecordSources", () => {
  it("hydrates detached tmux-only records from persisted cwd/title and pane command fallback", () => {
    const records = hydrateTmuxSurvivorRecordSources({
      tmuxIds: ["tmux-a", "tmux-a", "tmux-b"],
      liveIds: new Set(["tmux-b"]),
      cwdBySession: new Map([["tmux-a", "/repo/a"]]),
      titleBySession: new Map([["tmux-a", "Pinned title"]]),
      paneCommandOf: () => "codex",
      now: 123,
    });

    expect(records).toEqual([
      {
        id: "tmux-a",
        agent: "codex",
        cwd: "/repo/a",
        title: "Pinned title",
        createdAt: null,
        updatedAt: 123,
      },
    ]);
  });

  it("uses antigravity metadata as a cwd and created-at fallback", () => {
    const records = hydrateTmuxSurvivorRecordSources({
      tmuxIds: ["agy-session"],
      antigravityConversations: [{ sessionId: "agy-session", conversationId: "conversation", cwd: "/repo/agy", startedAt: 50 }],
      now: 75,
    });

    expect(records[0]).toMatchObject({
      id: "agy-session",
      cwd: "/repo/agy",
      createdAt: 50,
      updatedAt: 75,
    });
  });
});
