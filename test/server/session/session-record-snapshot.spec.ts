// @vitest-environment node
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

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const D = "44444444-4444-4444-4444-444444444444";

async function freshModules() {
  vi.resetModules();
  const registry = await import("../../../server/session/registry.js");
  const lifecycle = await import("../../../server/session/session-lifecycle-records.js");
  const snapshot = await import("../../../server/session/session-record-snapshot.js");
  return { lifecycle, registry, snapshot };
}

beforeEach(() => {
  vi.clearAllMocks();
  readBack = {};
});

describe("currentSessionRecords", () => {
  it("builds SessionRecords from the current registry and runtime facts", async () => {
    readBack = {
      "unplaced-sessions.json": `${B} codex\n${C} shell`,
      "placed-sessions.json": C,
      "dev-terminal-cwds.json": `${B} /repo/waiting\n`,
      "dev-terminal-sessions.json": A,
      "codex-rollout-ids.log": `${B} ${A}`,
    };
    const { registry, snapshot } = await freshModules();
    await Promise.all([
      registry.unplacedSessionsHydrated,
      registry.placedSessionsHydrated,
      registry.devTerminalCwdsHydrated,
      registry.devTerminalSessionsHydrated,
      registry.codexRolloutIdsHydrated,
    ]);

    registry.ptys.set(A, { cwd: "/repo/live", agent: "claude", tmux: true, ws: null } as never);
    registry.activity.set(B, { waiting: true, event: "Stop", at: 20 });
    registry.knownSessions.set(C, { title: "Placed", createdAt: 10 });

    const records = snapshot.currentSessionRecords({ tmuxIds: [A, B], now: 30 });
    const byId = new Map(records.map((record) => [record.id, record]));

    expect(byId.get(A)).toMatchObject({
      cwd: "/repo/live",
      visibility: "grid",
      lifecycle: "detached",
      runtime: { pty: true, tmux: true, attached: false },
    });
    expect(byId.get(B)).toMatchObject({
      agent: "codex",
      cwd: "/repo/waiting",
      visibility: "grid",
      lifecycle: "detached",
      placement: { unplaced: true, placed: false },
      resume: { codexRolloutId: A },
    });
    expect(byId.get(C)).toMatchObject({
      visibility: "history",
      placement: { unplaced: false, placed: true },
      title: "Placed",
    });
  });

  it("derives Mobile list sources from the same SessionRecord collection", async () => {
    readBack = {
      "unplaced-sessions.json": `${B} codex`,
      "dev-terminal-sessions.json": A,
    };
    const { lifecycle, registry, snapshot } = await freshModules();
    await Promise.all([registry.unplacedSessionsHydrated, registry.placedSessionsHydrated, registry.devTerminalSessionsHydrated]);

    registry.ptys.set(A, { cwd: "/repo/live", agent: "claude", ws: null } as never);
    registry.ptys.set(C, { cwd: "/repo/chat", agent: "shell", ws: null } as never);
    lifecycle.recordSessionStarting({ id: B, agent: "codex", cwd: "/repo/waiting" });
    registry.activity.set(B, { waiting: true, at: 20 });

    const sources = snapshot.currentMobileSessionRecordSources({ tmuxIds: [A, C] });

    expect(sources.ids).toEqual([A, B]);
    expect(sources.liveIds).toEqual([A]);
    expect(sources.tmuxIds).toEqual([A]);
    expect(sources.candidateIds).toEqual([B]);
    expect(sources.recordById.get(C)).toBeUndefined();
  });

  it("hydrates tmux-only survivors for the Mobile list from persisted SessionRecord metadata", async () => {
    readBack = {
      "unplaced-sessions.json": `${D} codex`,
      "dev-terminal-cwds.json": `${D} /repo/restarted\n`,
      "codex-rollout-ids.log": `${D} ${A}`,
    };
    const { registry, snapshot } = await freshModules();
    await snapshot.hydrateSessionRecordSnapshotInputs();
    registry.sessionMemos.set(D, "Phone task");

    const sources = snapshot.currentMobileSessionRecordSources({
      tmuxIds: [D],
      paneCommandOf: () => "bash",
      now: 40,
    });

    expect(sources.ids).toEqual([D]);
    expect(sources.liveIds).toEqual([]);
    expect(sources.tmuxIds).toEqual([D]);
    expect(sources.candidateIds).toEqual([]);
    expect(sources.recordById.get(D)).toMatchObject({
      id: D,
      agent: "codex",
      cwd: "/repo/restarted",
      title: "Phone task",
      lifecycle: "detached",
      runtime: { pty: false, tmux: true, attached: false },
      resume: { codexRolloutId: A },
      placement: { unplaced: true },
      updatedAt: 40,
    });
    expect(registry.ptys.has(D)).toBe(false);
  });

  it("excludes Mobile activity-only rows from active Session candidates", async () => {
    readBack = {
      "dev-terminal-sessions.json": [A, B, C, D].join("\n"),
    };
    const { registry, snapshot } = await freshModules();
    await registry.devTerminalSessionsHydrated;
    registry.activity.set(A, { waiting: true, at: 1 });
    registry.activity.set(B, { waiting: true, at: 4 });
    registry.activity.set(C, { working: true, at: 3 });
    registry.activity.set(D, { waiting: true, at: 2 });

    const sources = snapshot.currentMobileSessionRecordSources({ activityCandidateLimit: 2 });

    expect(sources.ids).toEqual([]);
    expect(sources.candidateIds).toEqual([]);
  });
});
