// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(async () => ""),
  appendFile: vi.fn(async (...args: unknown[]) => Promise.resolve(args.length).then(() => undefined)),
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("node:fs", () => ({
  promises: fsMock,
  default: { promises: fsMock },
}));

import {
  recordSessionDetached,
  recordKnownSessionStopped,
  recordSessionLive,
  recordSessionStarting,
  recordSessionStopped,
  sessionLifecycleRecordRows,
  sessionLifecycleRecords,
  STOPPED_SESSION_LIFECYCLE_RECORD_LIMIT,
} from "../../../server/session/session-lifecycle-records.js";

beforeEach(() => {
  vi.clearAllMocks();
  sessionLifecycleRecords.clear();
});

describe("session lifecycle writer", () => {
  it("creates starting records with stable creation time", () => {
    const record = recordSessionStarting({ id: "s1", agent: "claude", cwd: "/repo", now: 10 });

    expect(record).toEqual({
      id: "s1",
      lifecycle: "starting",
      agent: "claude",
      cwd: "/repo",
      createdAt: 10,
      updatedAt: 10,
    });
    expect(sessionLifecycleRecordRows()).toEqual([record]);
  });

  it("updates lifecycle and preserves known agent and cwd when omitted", () => {
    recordSessionStarting({ id: "s1", agent: "codex", cwd: "/repo", now: 10 });

    const detached = recordSessionDetached({ id: "s1", now: 20 });
    const stopped = recordSessionStopped({ id: "s1", now: 30 });

    expect(detached).toMatchObject({
      lifecycle: "detached",
      agent: "codex",
      cwd: "/repo",
      createdAt: 10,
      updatedAt: 20,
    });
    expect(stopped).toMatchObject({
      lifecycle: "stopped",
      agent: "codex",
      cwd: "/repo",
      createdAt: 10,
      updatedAt: 30,
    });
  });

  it("refreshes agent and cwd when a runtime attach has better metadata", () => {
    recordSessionStarting({ id: "s1", now: 10 });

    expect(recordSessionLive({ id: "s1", agent: "antigravity", cwd: "/repo/agy", now: 20 })).toMatchObject({
      lifecycle: "live",
      agent: "antigravity",
      cwd: "/repo/agy",
      createdAt: 10,
      updatedAt: 20,
    });
  });

  it("allows explicit null to clear stale agent and cwd metadata", () => {
    recordSessionLive({ id: "s1", agent: "codex", cwd: "/repo", now: 10 });

    expect(recordSessionStarting({ id: "s1", agent: null, cwd: null, now: 20 })).toMatchObject({
      lifecycle: "starting",
      agent: null,
      cwd: null,
      createdAt: 10,
      updatedAt: 20,
    });
  });

  it("stops only already-recorded sessions on generic spawn failure paths", () => {
    expect(recordKnownSessionStopped({ id: "run-only", now: 20 })).toBeNull();

    recordSessionStarting({ id: "s1", agent: "claude", cwd: "/repo", now: 10 });
    expect(recordKnownSessionStopped({ id: "s1", now: 20 })).toMatchObject({
      lifecycle: "stopped",
      agent: "claude",
      cwd: "/repo",
      createdAt: 10,
      updatedAt: 20,
    });
  });

  it("bounds retained stopped rows without pruning active lifecycle rows", () => {
    recordSessionLive({ id: "live", agent: "claude", cwd: "/repo", now: 0 });

    for (let i = 0; i <= STOPPED_SESSION_LIFECYCLE_RECORD_LIMIT; i++) {
      recordSessionStopped({ id: `stopped-${i}`, now: i + 1 });
    }

    expect(sessionLifecycleRecords.has("live")).toBe(true);
    expect(sessionLifecycleRecords.has("stopped-0")).toBe(false);
    expect(sessionLifecycleRecords.has(`stopped-${STOPPED_SESSION_LIFECYCLE_RECORD_LIMIT}`)).toBe(true);
    expect([...sessionLifecycleRecords.values()].filter((record) => record.lifecycle === "stopped")).toHaveLength(STOPPED_SESSION_LIFECYCLE_RECORD_LIMIT);
  });

  it("persists durable stopped tombstones for restart survivor suppression", async () => {
    const id = "01234567-89ab-cdef-0123-456789abcdef";

    recordSessionStopped({ id, now: 10 });
    recordSessionStopped({ id, now: 20 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fsMock.appendFile).toHaveBeenCalledTimes(1);
    expect(String(fsMock.appendFile.mock.calls[0]?.[1])).toContain(id);
  });

  it("persists an active marker when a stopped id is explicitly started again", async () => {
    const id = "01234567-89ab-cdef-0123-456789abcdef";

    recordSessionStopped({ id, now: 10 });
    recordSessionStarting({ id, agent: "claude", cwd: "/repo", now: 20 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const writes = fsMock.appendFile.mock.calls.map((call) => String(call[1]));
    expect(writes).toEqual([expect.stringContaining(`${id} stopped`), expect.stringContaining(`${id} active`)]);
  });

  it("persists active markers even when the stopped row is no longer in memory", async () => {
    const id = "01234567-89ab-cdef-0123-456789abcdef";

    recordSessionStarting({ id, agent: "claude", cwd: "/repo", now: 20 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(String(fsMock.appendFile.mock.calls[0]?.[1])).toContain(`${id} active`);
  });
});
