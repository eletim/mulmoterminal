// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildSessionRecords,
  selectBackgroundSessionRecords,
  selectCurrentMobileCandidateRecords,
  selectCurrentPcGridCandidateIds,
  selectGridVisibleSessionRecords,
  selectHistorySessionRecords,
  selectInternalSessionRecords,
  selectUnplacedSessionRecords,
} from "../../../server/session/session-records.js";

const ids = <T extends { id: string }>(records: readonly T[]) => records.map((record) => record.id);

describe("buildSessionRecords", () => {
  it("aggregates live runtime, placement, activity, cwd, and resume sources by session id", () => {
    const records = buildSessionRecords({
      now: 100,
      live: [{ id: "live", cwd: "/repo/live", agent: "claude", tmux: true }],
      tmuxIds: ["tmux-only"],
      known: [{ id: "known", title: "Starting", createdAt: 90 }],
      activity: [
        { id: "live", working: true, event: "Notification", at: 101 },
        { id: "waiting", waiting: true, event: "Stop", at: 80 },
      ],
      devTerminalIds: ["live", "cell-only"],
      unplaced: [
        { id: "waiting", agent: "codex" },
        { id: "placed", agent: "claude" },
      ],
      placedIds: ["placed"],
      cwdBySession: new Map([
        ["tmux-only", "/repo/tmux"],
        ["known", "/repo/known"],
      ]),
      claudeTranscriptIds: ["transcript"],
      codexRolloutIds: new Map([["codex-disk", "rollout-1"]]),
      antigravityConversations: [{ sessionId: "agy-disk", conversationId: "conversation-1", cwd: "/repo/agy", startedAt: 70 }],
    });

    const byId = new Map(records.map((record) => [record.id, record]));
    expect(byId.get("live")).toMatchObject({
      id: "live",
      agent: "claude",
      cwd: "/repo/live",
      visibility: "grid",
      lifecycle: "live",
      runtime: { pty: true, tmux: true, attached: true },
      placement: { gridCell: true, unplaced: false, placed: false },
      activity: { working: true, waiting: false, event: "Notification", at: 101 },
      updatedAt: 101,
    });
    expect(byId.get("waiting")).toMatchObject({
      agent: "codex",
      visibility: "grid",
      lifecycle: "detached",
      placement: { gridCell: false, unplaced: true, placed: false },
      activity: { waiting: true, event: "Stop", at: 80 },
    });
    expect(byId.get("placed")).toMatchObject({
      visibility: "history",
      lifecycle: "stopped",
      placement: { gridCell: false, unplaced: false, placed: true },
    });
    expect(byId.get("tmux-only")).toMatchObject({
      cwd: "/repo/tmux",
      lifecycle: "detached",
      runtime: { pty: false, tmux: true, attached: false },
    });
    expect(byId.get("known")).toMatchObject({
      title: "Starting",
      cwd: "/repo/known",
      lifecycle: "starting",
      createdAt: 90,
      updatedAt: 90,
    });
    expect(byId.get("transcript")).toMatchObject({
      agent: "claude",
      visibility: "history",
      lifecycle: "stopped",
      resume: { claudeTranscript: true },
    });
    expect(byId.get("codex-disk")).toMatchObject({
      agent: "codex",
      visibility: "history",
      lifecycle: "stopped",
      resume: { codexRolloutId: "rollout-1" },
    });
    expect(byId.get("agy-disk")).toMatchObject({
      agent: "antigravity",
      cwd: "/repo/agy",
      createdAt: 70,
      updatedAt: 70,
      resume: { antigravityConversationId: "conversation-1" },
    });
  });

  it("keeps background and internal classification separate from grid placement", () => {
    const records = buildSessionRecords({
      live: [
        { id: "background-grid", cwd: "/repo/bg", agent: "claude" },
        { id: "internal-grid", cwd: "/repo/internal", agent: "codex" },
      ],
      devTerminalIds: ["background-grid", "internal-grid"],
      backgroundIds: ["background-grid", "internal-grid"],
      internalIds: ["internal-grid"],
    });

    expect(ids(selectBackgroundSessionRecords(records))).toEqual(["background-grid"]);
    expect(ids(selectInternalSessionRecords(records))).toEqual(["internal-grid"]);
    expect(ids(selectGridVisibleSessionRecords(records))).toEqual([]);
  });
});

describe("SessionRecord selectors", () => {
  it("selects grid-visible sessions without treating stopped or failed records as active grid existence", () => {
    const records = buildSessionRecords({
      live: [{ id: "live", cwd: "/repo/live", agent: "claude" }],
      devTerminalIds: ["live", "stopped", "failed"],
      failedIds: ["failed"],
      claudeTranscriptIds: ["stopped"],
    });

    expect(ids(selectGridVisibleSessionRecords(records))).toEqual(["live"]);
  });

  it("selects history records from resumable non-grid sources", () => {
    const records = buildSessionRecords({
      codexRolloutIds: new Map([["codex-chat", "rollout-2"]]),
      devTerminalIds: ["grid-transcript"],
      claudeTranscriptIds: ["claude-chat", "grid-transcript"],
    });

    expect(ids(selectHistorySessionRecords(records))).toEqual(["claude-chat", "codex-chat"]);
  });

  it("models the current PC grid bootstrap as persisted cells plus unplaced sessions", () => {
    const records = buildSessionRecords({
      live: [{ id: "live-not-in-grid", cwd: "/repo/live", agent: "shell" }],
      tmuxIds: ["tmux-only"],
      unplaced: [
        { id: "phone-spawn", agent: "claude" },
        { id: "background-spawn", agent: "codex" },
      ],
      backgroundIds: ["background-spawn"],
    });

    expect(ids(selectUnplacedSessionRecords(records))).toEqual(["phone-spawn"]);
    expect(selectCurrentPcGridCandidateIds(records, ["cell-a", "cell-b"])).toEqual(["cell-a", "cell-b", "phone-spawn"]);
  });

  it("models the target shared grid existence as visibility plus active lifecycle", () => {
    const records = buildSessionRecords({
      live: [
        { id: "live-grid", cwd: "/repo/live", agent: "claude" },
        { id: "background-grid", cwd: "/repo/bg", agent: "claude" },
      ],
      tmuxIds: ["tmux-survivor"],
      devTerminalIds: ["live-grid", "stopped-grid", "failed-grid", "background-grid", "tmux-survivor"],
      failedIds: ["failed-grid"],
      backgroundIds: ["background-grid"],
      claudeTranscriptIds: ["stopped-grid"],
    });

    expect(ids(selectGridVisibleSessionRecords(records))).toEqual(["live-grid", "tmux-survivor"]);
  });

  it("models the current Mobile list source as grid-gated live, tmux, and active activity", () => {
    const records = buildSessionRecords({
      live: [
        { id: "live-grid", cwd: "/repo/live-grid", agent: "claude" },
        { id: "live-chat", cwd: "/repo/live-chat", agent: "claude" },
      ],
      tmuxIds: ["tmux-grid", "tmux-chat"],
      devTerminalIds: ["live-grid", "tmux-grid", "activity-grid", "idle-grid"],
      activity: [
        { id: "activity-grid", waiting: true, at: 40 },
        { id: "activity-chat", waiting: true, at: 30 },
        { id: "idle-grid", at: 20 },
      ],
    });

    expect(ids(selectCurrentMobileCandidateRecords(records))).toEqual(["live-grid", "tmux-grid", "activity-grid"]);
  });
});
