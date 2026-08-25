// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockedFileName } from "../../support/mockFsPath.js";

let readBack: Record<string, string> = {};
let readDelays: Record<string, Promise<void>> = {};

vi.mock("node:fs", () => {
  const promises = {
    readFile: vi.fn(async (file: unknown) => {
      const name = mockedFileName(file);
      await readDelays[name];
      return readBack[name] ?? "";
    }),
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
  readDelays = {};
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

    const sources = snapshot.currentTerminalSessionRecordSources({ tmuxIds: [A, C] });

    expect(sources.ids).toEqual([A, B]);
    expect(sources.liveIds).toEqual([A]);
    expect(sources.tmuxIds).toEqual([A]);
    expect(sources.candidateIds).toEqual([B]);
    expect(sources.recordById.has(C)).toBe(false);
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

    const sources = snapshot.currentTerminalSessionRecordSources({
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

  it("waits for persisted cwd hydration before building restart survivor records", async () => {
    readBack = {
      "unplaced-sessions.json": `${D} codex`,
      "dev-terminal-cwds.json": `${D} /repo/delayed\n`,
    };
    let releaseCwd!: () => void;
    readDelays = {
      "dev-terminal-cwds.json": new Promise((resolve) => {
        releaseCwd = resolve;
      }),
    };
    const { snapshot } = await freshModules();
    let hydrated = false;
    const hydration = snapshot.hydrateSessionRecordSnapshotInputs().then(() => {
      hydrated = true;
    });

    await Promise.resolve();
    expect(hydrated).toBe(false);
    releaseCwd();
    await hydration;

    expect(snapshot.currentSessionRecords({ tmuxIds: [D], now: 40 })[0]).toMatchObject({
      id: D,
      cwd: "/repo/delayed",
      lifecycle: "detached",
    });
  });

  it("does not let delayed stopped hydration overwrite a current active lifecycle write", async () => {
    readBack = {
      "stopped-session-lifecycle.json": D,
    };
    let releaseLifecycle!: () => void;
    readDelays = {
      "stopped-session-lifecycle.json": new Promise((resolve) => {
        releaseLifecycle = resolve;
      }),
    };
    const { lifecycle } = await freshModules();

    lifecycle.recordSessionStarting({ id: D, agent: "claude", cwd: "/repo/current", now: 10 });
    releaseLifecycle();
    await lifecycle.sessionLifecycleRecordsHydrated;

    expect(lifecycle.sessionLifecycleRecords.get(D)).toMatchObject({
      lifecycle: "starting",
      agent: "claude",
      cwd: "/repo/current",
    });
  });

  it("does not let delayed active hydration clear a current stopped lifecycle write", async () => {
    readBack = {
      "stopped-session-lifecycle.json": `${D} stopped\n${D} active`,
    };
    let releaseLifecycle!: () => void;
    readDelays = {
      "stopped-session-lifecycle.json": new Promise((resolve) => {
        releaseLifecycle = resolve;
      }),
    };
    const { lifecycle } = await freshModules();

    lifecycle.recordSessionStopped({ id: D, agent: "claude", cwd: "/repo/current", now: 10 });
    releaseLifecycle();
    await lifecycle.sessionLifecycleRecordsHydrated;

    expect(lifecycle.sessionLifecycleRecords.get(D)).toMatchObject({
      lifecycle: "stopped",
      agent: "claude",
      cwd: "/repo/current",
    });
  });

  it("does not treat activity-only dev records as current terminal sessions", async () => {
    readBack = {
      "dev-terminal-sessions.json": [A, B, C, D].join("\n"),
    };
    const { registry, snapshot } = await freshModules();
    await registry.devTerminalSessionsHydrated;
    registry.activity.set(A, { waiting: true, at: 1 });
    registry.activity.set(B, { waiting: true, at: 4 });
    registry.activity.set(C, { working: true, at: 3 });
    registry.activity.set(D, { waiting: true, at: 2 });

    const sources = snapshot.currentTerminalSessionRecordSources();

    expect(sources.ids).toEqual([]);
    expect(sources.candidateIds).toEqual([]);
  });

  it("excludes explicitly deleted records from fresh SessionRecord snapshots", async () => {
    readBack = {
      "dev-terminal-sessions.json": [A, B].join("\n"),
      "deleted-session-records.log": A,
    };
    const { registry, snapshot } = await freshModules();
    await snapshot.hydrateSessionRecordSnapshotInputs();
    registry.ptys.set(A, { cwd: "/repo/deleted", agent: "claude", ws: null } as never);
    registry.ptys.set(B, { cwd: "/repo/current", agent: "codex", ws: null } as never);

    expect(snapshot.currentSessionRecords().map((record) => record.id)).toEqual([B]);
    expect(snapshot.currentTerminalSessionRecordSources().ids).toEqual([B]);
  });

  it("replays an active deletion marker so a resumed id is visible after restart", async () => {
    readBack = {
      "dev-terminal-sessions.json": A,
      "deleted-session-records.log": `${A}\n${A} active`,
    };
    const { registry, snapshot } = await freshModules();
    await snapshot.hydrateSessionRecordSnapshotInputs();
    registry.ptys.set(A, { cwd: "/repo/resumed", agent: "claude", ws: null } as never);

    expect(snapshot.currentSessionRecords().map((record) => record.id)).toEqual([A]);
    expect(snapshot.currentTerminalSessionRecordSources().ids).toEqual([A]);
  });
});
