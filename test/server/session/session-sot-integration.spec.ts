// @vitest-environment node
// Cross-surface Session SoT tests for the v1.1.0 integration gate (#120). These keep PC grid and
// Mobile list answers tied to the same SessionRecord snapshot instead of testing either surface in
// isolation.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockedFileName } from "../../support/mockFsPath.js";

let readBack: Record<string, string> = {};

vi.mock("node:fs", () => {
  const promises = {
    readFile: vi.fn(async (file: unknown) => readBack[mockedFileName(file)] ?? ""),
    appendFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  return { promises, default: { promises } };
});

const CLAUDE = "11111111-1111-1111-1111-111111111111";
const CODEX = "22222222-2222-2222-2222-222222222222";
const ANTIGRAVITY = "33333333-3333-3333-3333-333333333333";
const SHELL = "44444444-4444-4444-4444-444444444444";
const EXTRA = "55555555-5555-5555-5555-555555555555";
const STALE = "66666666-6666-6666-6666-666666666666";
const BACKGROUND = "77777777-7777-7777-7777-777777777777";
const INTERNAL = "88888888-8888-8888-8888-888888888888";
const UNPLACED_MARKER = "99999999-9999-9999-9999-999999999999";

async function freshModules() {
  vi.resetModules();
  const registry = await import("../../../server/session/registry.js");
  const lifecycle = await import("../../../server/session/session-lifecycle-records.js");
  const snapshot = await import("../../../server/session/session-record-snapshot.js");
  const records = await import("../../../server/session/session-records.js");
  const mobile = await import("../../../server/mobileTerminal/terminalScreen.js");
  return { lifecycle, mobile, records, registry, snapshot };
}

beforeEach(() => {
  vi.clearAllMocks();
  readBack = {};
});

describe("Session SoT integration across PC grid and Mobile", () => {
  it("lists the same active PC-created Claude, Codex, Antigravity, and Shell grid sessions on Mobile", async () => {
    readBack = {
      "dev-terminal-sessions.json": [CLAUDE, CODEX, ANTIGRAVITY, SHELL].join("\n"),
    };
    const { mobile, records, registry, snapshot } = await freshModules();
    await snapshot.hydrateSessionRecordSnapshotInputs();
    registry.ptys.set(CLAUDE, { cwd: "/repo/claude", agent: "claude", tmux: true, ws: {} } as never);
    registry.ptys.set(CODEX, { cwd: "/repo/codex", agent: "codex", tmux: true, ws: {} } as never);
    registry.ptys.set(ANTIGRAVITY, { cwd: "/repo/agy", agent: "antigravity", tmux: true, ws: {} } as never);
    registry.ptys.set(SHELL, { cwd: "/repo/shell", agent: "shell", tmux: true, ws: {} } as never);

    const current = snapshot.currentSessionRecords({ tmuxIds: [CLAUDE, CODEX, ANTIGRAVITY, SHELL] });
    const mobileSources = snapshot.currentMobileSessionRecordSources({ tmuxIds: [CLAUDE, CODEX, ANTIGRAVITY, SHELL] });
    const mobileRows = mobile.buildSessionList({
      candidateIds: mobileSources.candidateIds,
      liveIds: mobileSources.liveIds,
      tmuxIds: mobileSources.tmuxIds,
      detailOf: (id) => {
        const record = mobileSources.recordById.get(id);
        return { title: record?.agent ?? id, cwd: record?.cwd ?? "", agent: record?.agent ?? null };
      },
    });

    expect(records.selectGridVisibleSessionRecords(current).map((record) => record.id)).toEqual([CLAUDE, CODEX, ANTIGRAVITY, SHELL]);
    expect(mobileRows.map((row) => [row.id, row.agent, row.live, row.inputAvailable])).toEqual([
      [ANTIGRAVITY, "antigravity", true, true],
      [CLAUDE, "claude", true, true],
      [CODEX, "codex", true, true],
      [SHELL, "shell", true, true],
    ]);
  });

  it("exposes Mobile-created sessions as unplaced PC grid candidates without adding a second SoT", async () => {
    readBack = {
      "dev-terminal-sessions.json": [CLAUDE, CODEX, ANTIGRAVITY, SHELL].join("\n"),
      "unplaced-sessions.json": `${CLAUDE} claude\n${CODEX} codex\n${ANTIGRAVITY} antigravity\n${SHELL} shell`,
    };
    const { lifecycle, records, registry, snapshot } = await freshModules();
    await snapshot.hydrateSessionRecordSnapshotInputs();
    const agents = [
      [CLAUDE, "claude", "/mobile/claude"],
      [CODEX, "codex", "/mobile/codex"],
      [ANTIGRAVITY, "antigravity", "/mobile/agy"],
      [SHELL, "shell", "/mobile/shell"],
    ] as const;
    for (const [id, agent, cwd] of agents) {
      lifecycle.recordSessionLive({ id, agent, cwd, now: 10 });
      registry.ptys.set(id, { cwd, agent, tmux: true, ws: null } as never);
    }

    const current = snapshot.currentSessionRecords({ tmuxIds: agents.map(([id]) => id) });

    expect(records.selectUnplacedSessionRecords(current).map((record) => [record.id, record.agent, record.cwd])).toEqual(agents);
    expect(records.selectCurrentPcGridCandidateIds(current, [])).toEqual([CLAUDE, CODEX, ANTIGRAVITY, SHELL]);
  });

  it("keeps restart-surviving visible unplaced agent sessions discoverable before transcripts exist", async () => {
    readBack = {
      "dev-terminal-cwds.json": `${CLAUDE} /mobile/claude\n${CODEX} /mobile/codex\n${ANTIGRAVITY} /mobile/agy\n`,
      "unplaced-sessions.json": `${CLAUDE} claude\n${CODEX} codex\n${ANTIGRAVITY} antigravity`,
    };
    const { records, snapshot } = await freshModules();
    await snapshot.hydrateSessionRecordSnapshotInputs();

    const current = snapshot.currentSessionRecords({ tmuxIds: [CLAUDE, CODEX, ANTIGRAVITY], paneCommandOf: () => "bash", now: 50 });
    const mobileSources = snapshot.currentMobileSessionRecordSources({ tmuxIds: [CLAUDE, CODEX, ANTIGRAVITY], paneCommandOf: () => "bash", now: 50 });

    expect(records.selectUnplacedSessionRecords(current).map((record) => [record.id, record.agent, record.cwd, record.lifecycle])).toEqual([
      [CLAUDE, "claude", "/mobile/claude", "detached"],
      [CODEX, "codex", "/mobile/codex", "detached"],
      [ANTIGRAVITY, "antigravity", "/mobile/agy", "detached"],
    ]);
    expect(mobileSources.ids).toEqual([CLAUDE, CODEX, ANTIGRAVITY]);
  });

  it("hydrates a tmux-only survivor after restart for both PC grid and Mobile reattach", async () => {
    readBack = {
      "dev-terminal-sessions.json": CODEX,
      "dev-terminal-cwds.json": `${CODEX} /repo/restarted\n`,
      "codex-rollout-ids.log": `${CODEX} ${EXTRA}`,
    };
    const { mobile, records, registry, snapshot } = await freshModules();
    await snapshot.hydrateSessionRecordSnapshotInputs();
    registry.sessionMemos.set(CODEX, "Restarted Codex task");

    const current = snapshot.currentSessionRecords({ tmuxIds: [CODEX], paneCommandOf: () => "bash", now: 50 });
    const mobileSources = snapshot.currentMobileSessionRecordSources({ tmuxIds: [CODEX], paneCommandOf: () => "bash", now: 50 });
    const mobileRows = mobile.buildSessionList({
      candidateIds: mobileSources.candidateIds,
      liveIds: mobileSources.liveIds,
      tmuxIds: mobileSources.tmuxIds,
      detailOf: (id) => {
        const record = mobileSources.recordById.get(id);
        return { title: record?.title ?? "survivor", cwd: record?.cwd ?? "", agent: record?.agent ?? null };
      },
    });

    expect(records.selectGridVisibleSessionRecords(current)[0]).toMatchObject({
      id: CODEX,
      agent: "codex",
      cwd: "/repo/restarted",
      lifecycle: "detached",
      runtime: { pty: false, tmux: true, attached: false },
    });
    expect(mobileRows).toEqual([
      expect.objectContaining({ id: CODEX, title: "Restarted Codex task", cwd: "/repo/restarted", live: false, inputAvailable: true, agent: "codex" }),
    ]);
  });

  it("keeps a detached-finished Codex record visible after reap until the user explicitly deletes it", async () => {
    readBack = {
      "dev-terminal-sessions.json": [CODEX, CLAUDE, SHELL].join("\n"),
      "dev-terminal-cwds.json": `${CODEX} /repo/codex\n${CLAUDE} /repo/claude\n${SHELL} /repo/shell\n`,
      "codex-rollout-ids.log": `${CODEX} ${EXTRA}`,
    };
    const { lifecycle, mobile, registry, snapshot } = await freshModules();
    await snapshot.hydrateSessionRecordSnapshotInputs();

    registry.ptys.set(CODEX, { cwd: "/repo/codex", agent: "codex", tmux: true, ws: {} } as never);
    lifecycle.recordSessionLive({ id: CODEX, agent: "codex", cwd: "/repo/codex", now: 10 });

    const codexEntry = registry.ptys.get(CODEX);
    if (!codexEntry) throw new Error("missing Codex pty");
    codexEntry.ws = null;
    lifecycle.recordSessionDetached({ id: CODEX, agent: "codex", cwd: "/repo/codex", now: 20 });
    registry.activity.set(CODEX, { waiting: true, event: "Stop", at: 30 });

    registry.ptys.delete(CODEX);
    lifecycle.recordSessionStopped({ id: CODEX, agent: "codex", cwd: "/repo/codex", now: 40 });
    lifecycle.recordSessionStopped({ id: CLAUDE, agent: "claude", cwd: "/repo/claude", now: 41 });
    lifecycle.recordSessionStopped({ id: SHELL, agent: "shell", cwd: "/repo/shell", now: 42 });
    registry.sessionMemos.set(CODEX, "Finished Codex task");
    registry.sessionMemos.set(CLAUDE, "Finished Claude task");
    registry.sessionMemos.set(SHELL, "Finished Shell task");

    const afterReap = snapshot.currentMobileSessionRecordSources({ now: 50 });
    const rows = mobile.buildSessionList({
      candidateIds: afterReap.candidateIds,
      liveIds: afterReap.liveIds,
      tmuxIds: afterReap.tmuxIds,
      detailOf: (id) => {
        const record = afterReap.recordById.get(id);
        return { title: registry.sessionMemos.get(id) ?? "", cwd: record?.cwd ?? "", agent: record?.agent ?? null };
      },
    });

    expect(new Set(afterReap.ids)).toEqual(new Set([CODEX, CLAUDE, SHELL]));
    expect(afterReap.recordById.get(CODEX)).toMatchObject({
      lifecycle: "stopped",
      runtime: { pty: false, tmux: false, attached: false },
      resume: { codexRolloutId: EXTRA },
    });
    expect(rows.map((row) => [row.id, row.title, row.live, row.inputAvailable, row.agent])).toEqual([
      [CLAUDE, "Finished Claude task", false, false, "claude"],
      [CODEX, "Finished Codex task", false, false, "codex"],
      [SHELL, "Finished Shell task", false, false, "shell"],
    ]);

    lifecycle.recordSessionDeleted(CODEX);
    expect(snapshot.currentMobileSessionRecordSources({ now: 60 }).ids).toEqual([SHELL, CLAUDE]);

    registry.ptys.set(CODEX, { cwd: "/repo/codex", agent: "codex", tmux: true, ws: {} } as never);
    lifecycle.recordSessionLive({ id: CODEX, agent: "codex", cwd: "/repo/codex", now: 70 });
    expect(new Set(snapshot.currentMobileSessionRecordSources({ tmuxIds: [CODEX], now: 80 }).ids)).toEqual(new Set([CODEX, SHELL, CLAUDE]));
  });

  it("keeps stopped user sessions in PC and Mobile existence while excluding background and internal records", async () => {
    readBack = {
      "dev-terminal-sessions.json": [CLAUDE, STALE, EXTRA, BACKGROUND, INTERNAL, UNPLACED_MARKER].join("\n"),
      "unplaced-sessions.json": `${UNPLACED_MARKER} claude`,
    };
    const { lifecycle, records, registry, snapshot } = await freshModules();
    await snapshot.hydrateSessionRecordSnapshotInputs();
    registry.ptys.set(CLAUDE, { cwd: "/repo/live", agent: "claude", tmux: true, ws: {} } as never);
    registry.ptys.set(BACKGROUND, { cwd: "/repo/background", agent: "codex", tmux: true, ws: {} } as never);
    registry.ptys.set(INTERNAL, { cwd: "/repo/internal", agent: "claude", tmux: true, ws: {} } as never);
    registry.activity.set(STALE, { waiting: true, event: "Stop", at: 30 });
    lifecycle.recordSessionStopped({ id: EXTRA, agent: "shell", cwd: "/repo/stopped", now: 40 });
    registry.backgroundMarkers.add(BACKGROUND);
    registry.translationWorkerIds.add(INTERNAL);

    const current = snapshot.currentSessionRecords({ tmuxIds: [CLAUDE, EXTRA, BACKGROUND, INTERNAL] });
    const mobileSources = snapshot.currentMobileSessionRecordSources({ tmuxIds: [CLAUDE, EXTRA, BACKGROUND, INTERNAL] });

    expect(new Set(records.selectGridVisibleSessionRecords(current).map((record) => record.id))).toEqual(new Set([CLAUDE, STALE, EXTRA, UNPLACED_MARKER]));
    expect(records.selectUnplacedSessionRecords(current).map((record) => record.id)).toEqual([UNPLACED_MARKER]);
    expect(new Set(mobileSources.ids)).toEqual(new Set([EXTRA, STALE, CLAUDE, UNPLACED_MARKER]));
    expect(current.find((record) => record.id === EXTRA)).toMatchObject({
      lifecycle: "stopped",
      runtime: { pty: false, tmux: true, attached: false },
    });
  });

  it("keeps a durably stopped session from reviving as a tmux-only survivor after restart", async () => {
    readBack = {
      "dev-terminal-sessions.json": EXTRA,
      "dev-terminal-cwds.json": `${EXTRA} /repo/stopped\n`,
      "stopped-session-lifecycle.json": EXTRA,
    };
    const { records, snapshot } = await freshModules();
    await snapshot.hydrateSessionRecordSnapshotInputs();

    const current = snapshot.currentSessionRecords({ tmuxIds: [EXTRA], paneCommandOf: () => "bash", now: 50 });
    const mobileSources = snapshot.currentMobileSessionRecordSources({ tmuxIds: [EXTRA], paneCommandOf: () => "bash", now: 50 });

    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({
      id: EXTRA,
      cwd: "/repo/stopped",
      lifecycle: "stopped",
      runtime: { pty: false, tmux: true, attached: false },
    });
    expect(records.selectGridVisibleSessionRecords(current).map((record) => record.id)).toEqual([EXTRA]);
    expect(mobileSources.ids).toEqual([EXTRA]);
  });
});
