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
      lifecycle: [{ id: "waiting", lifecycle: "detached", agent: "codex", cwd: null, createdAt: 70, updatedAt: 80 }],
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

  it("uses lifecycle writer rows as the fallback lifecycle, agent, cwd, and timestamps", () => {
    const records = buildSessionRecords({
      lifecycle: [
        {
          id: "writer-only",
          lifecycle: "detached",
          agent: "codex",
          cwd: "/repo/writer",
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "writer-only",
      agent: "codex",
      cwd: "/repo/writer",
      lifecycle: "detached",
      createdAt: 10,
      updatedAt: 20,
    });
  });

  it("keeps live runtime authoritative during the dual-write period", () => {
    const records = buildSessionRecords({
      now: 30,
      live: [{ id: "same", cwd: "/repo/live", agent: "claude" }],
      lifecycle: [
        {
          id: "same",
          lifecycle: "stopped",
          agent: "codex",
          cwd: "/repo/writer",
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    });

    expect(records[0]).toMatchObject({
      id: "same",
      agent: "claude",
      cwd: "/repo/live",
      lifecycle: "live",
      runtime: { pty: true },
      createdAt: 10,
      updatedAt: 30,
    });
  });

  it("keeps stopped lifecycle tombstones ahead of tmux-only survivor detection", () => {
    const records = buildSessionRecords({
      live: [{ id: "reattached", cwd: "/repo/live", agent: "claude", tmux: true }],
      tmuxIds: ["stopped", "reattached"],
      lifecycle: [
        {
          id: "stopped",
          lifecycle: "stopped",
          agent: "codex",
          cwd: "/repo/stopped",
          createdAt: 10,
          updatedAt: 20,
        },
        {
          id: "reattached",
          lifecycle: "stopped",
          agent: "codex",
          cwd: "/repo/old",
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    });
    const byId = new Map(records.map((record) => [record.id, record]));

    expect(byId.get("stopped")).toMatchObject({
      lifecycle: "stopped",
      runtime: { pty: false, tmux: true, attached: false },
    });
    expect(byId.get("reattached")).toMatchObject({
      lifecycle: "live",
      cwd: "/repo/live",
      runtime: { pty: true, tmux: true, attached: true },
    });
  });

  it("lets lifecycle writer rows retire legacy starting markers during dual-write", () => {
    const records = buildSessionRecords({
      known: [{ id: "same", title: "Starting", createdAt: 10 }],
      lifecycle: [
        {
          id: "same",
          lifecycle: "stopped",
          agent: "claude",
          cwd: "/repo",
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    });

    expect(records[0]).toMatchObject({
      id: "same",
      title: "Starting",
      lifecycle: "stopped",
      createdAt: 10,
      updatedAt: 20,
    });
  });

  it("uses tmux survivor metadata as a detached runtime fallback after restart", () => {
    const records = buildSessionRecords({
      tmuxIds: ["survivor"],
      tmuxSurvivors: [
        {
          id: "survivor",
          agent: "shell",
          cwd: "/repo/survivor",
          title: "Restored survivor",
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    });

    expect(records[0]).toMatchObject({
      id: "survivor",
      agent: "shell",
      cwd: "/repo/survivor",
      title: "Restored survivor",
      lifecycle: "detached",
      runtime: { pty: false, tmux: true, attached: false },
      createdAt: 10,
      updatedAt: 20,
    });
  });

  it("keeps persisted resume metadata ahead of tmux pane-command fallback", () => {
    const records = buildSessionRecords({
      tmuxIds: ["codex-survivor", "claude-survivor"],
      codexRolloutIds: new Map([["codex-survivor", "rollout"]]),
      claudeTranscriptIds: ["claude-survivor"],
      tmuxSurvivors: [
        { id: "codex-survivor", agent: "shell", cwd: null, title: null, createdAt: null, updatedAt: 20 },
        { id: "claude-survivor", agent: "shell", cwd: null, title: null, createdAt: null, updatedAt: 20 },
      ],
    });

    const byId = new Map(records.map((record) => [record.id, record]));
    expect(byId.get("codex-survivor")).toMatchObject({ agent: "codex", resume: { codexRolloutId: "rollout" } });
    expect(byId.get("claude-survivor")).toMatchObject({ agent: "claude", resume: { claudeTranscript: true } });
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
      lifecycle: [
        { id: "phone-spawn", lifecycle: "starting", agent: "claude", cwd: "/repo/phone", createdAt: 10, updatedAt: 20 },
        { id: "background-spawn", lifecycle: "starting", agent: "codex", cwd: "/repo/bg", createdAt: 10, updatedAt: 20 },
      ],
      unplaced: [
        { id: "phone-spawn", agent: "claude" },
        { id: "background-spawn", agent: "codex" },
      ],
      backgroundIds: ["background-spawn"],
    });

    expect(ids(selectUnplacedSessionRecords(records))).toEqual(["phone-spawn"]);
    expect(selectCurrentPcGridCandidateIds(records, ["cell-a", "cell-b"])).toEqual(["cell-a", "cell-b", "phone-spawn"]);
  });

  it("does not promote marker-only or activity-only stale records to active grid existence", () => {
    const records = buildSessionRecords({
      devTerminalIds: ["grid-marker", "activity-marker", "stopped-marker"],
      lifecycle: [{ id: "stopped-marker", lifecycle: "stopped", agent: "claude", cwd: "/repo/stopped", createdAt: 10, updatedAt: 20 }],
      unplaced: [
        { id: "unplaced-marker", agent: "claude" },
        { id: "stopped-marker", agent: "claude" },
      ],
      activity: [{ id: "activity-marker", waiting: true, at: 40 }],
    });

    expect(ids(selectGridVisibleSessionRecords(records))).toEqual([]);
    expect(ids(selectUnplacedSessionRecords(records))).toEqual([]);
    expect(ids(selectCurrentMobileCandidateRecords(records))).toEqual([]);
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

  it("models the current Mobile list source as grid-gated active lifecycle records", () => {
    const records = buildSessionRecords({
      live: [
        { id: "live-grid", cwd: "/repo/live-grid", agent: "claude" },
        { id: "live-chat", cwd: "/repo/live-chat", agent: "claude" },
      ],
      tmuxIds: ["tmux-grid", "tmux-chat"],
      lifecycle: [{ id: "starting-grid", lifecycle: "starting", agent: "codex", cwd: "/repo/starting", createdAt: 10, updatedAt: 20 }],
      devTerminalIds: ["live-grid", "tmux-grid", "starting-grid", "activity-grid", "idle-grid"],
      activity: [
        { id: "activity-grid", waiting: true, at: 40 },
        { id: "activity-chat", waiting: true, at: 30 },
        { id: "idle-grid", at: 20 },
      ],
    });

    expect(ids(selectCurrentMobileCandidateRecords(records))).toEqual(["live-grid", "tmux-grid", "starting-grid"]);
  });
});
