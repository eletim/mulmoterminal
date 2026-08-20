// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  idsNeedingPersistentDetail,
  mobileActivityCandidateIds,
  persistentMobileDetail,
  persistentMobileDetails,
} from "../../../server/mobileTerminal/mobileSessionList.js";

describe("mobileActivityCandidateIds", () => {
  it("adds only activity-backed grid sessions not already covered by live or tmux sources", () => {
    const ids = mobileActivityCandidateIds({
      liveIds: ["live"],
      tmuxIds: ["tmux"],
      activityEntries: [
        ["live", { waiting: true, at: 5 }],
        ["tmux", { waiting: true, at: 4 }],
        ["idle", { at: 3 }],
        ["chat", { waiting: true, at: 2 }],
        ["finished", { waiting: true, at: 1 }],
      ],
      isGridSession: (id) => id !== "chat",
    });
    expect(ids).toEqual(["finished"]);
  });

  it("keeps the newest bounded candidates", () => {
    const ids = mobileActivityCandidateIds({
      liveIds: [],
      tmuxIds: [],
      activityEntries: [
        ["old", { waiting: true, at: 1 }],
        ["new", { working: true, at: 3 }],
        ["middle", { waiting: true, at: 2 }],
      ],
      isGridSession: () => true,
      limit: 2,
    });
    expect(ids).toEqual(["new", "middle"]);
  });
});

describe("idsNeedingPersistentDetail", () => {
  it("skips sessions that already have an in-memory title", () => {
    expect(idsNeedingPersistentDetail(["named", "missing"], (id) => (id === "named" ? "live title" : ""))).toEqual(["missing"]);
  });
});

describe("persistentMobileDetail", () => {
  it("uses a mapped Codex rollout before trying Claude transcripts", async () => {
    const readClaude = vi.fn();
    await expect(
      persistentMobileDetail("session", "/repo", {
        rolloutIdOf: () => "rollout",
        readCodex: async () => ({ title: "Codex title", cwd: "/codex-repo" }),
        readClaude,
      }),
    ).resolves.toEqual({ title: "Codex title", cwd: "/codex-repo", agent: "codex" });
    expect(readClaude).not.toHaveBeenCalled();
  });

  it("falls back to the Claude transcript title for sessions with a cwd", async () => {
    await expect(
      persistentMobileDetail("session", "/repo", {
        rolloutIdOf: () => undefined,
        readCodex: async () => null,
        readClaude: async () => ({ title: "Claude title" }),
      }),
    ).resolves.toEqual({ title: "Claude title", cwd: "/repo", agent: "claude" });
  });

  it("returns null when no persistent title is available", async () => {
    await expect(
      persistentMobileDetail("session", "", {
        rolloutIdOf: () => undefined,
        readCodex: async () => null,
        readClaude: async () => ({ title: "unused" }),
      }),
    ).resolves.toBeNull();
  });
});

describe("persistentMobileDetails", () => {
  it("returns only details that can be restored", async () => {
    const details = await persistentMobileDetails(["a", "b"], () => "/repo", {
      rolloutIdOf: () => undefined,
      readCodex: async () => null,
      readClaude: async (id) => (id === "a" ? { title: "A" } : null),
    });
    expect([...details]).toEqual([["a", { title: "A", cwd: "/repo", agent: "claude" }]]);
  });
});
