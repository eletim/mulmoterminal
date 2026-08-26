// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createOrchestratorStatusReader } from "../../../server/routes/orchestrator-session-status.js";
import type { Activity } from "../../../server/session/types.js";

const ID = "11111111-2222-4333-8444-555555555555";
const session = (exited = false) => ({
  id: ID,
  command: "/bin/sh",
  cwd: "/work",
  createdAt: new Date(1),
  attached: false,
  processId: 123,
  exited,
  exitCode: exited ? 0 : null,
  cols: 80,
  rows: 24,
  currentCommand: "sh",
  agent: "shell" as const,
  title: null,
  memo: null,
  resumeSource: null,
  visibility: "normal" as const,
});

describe("createOrchestratorStatusReader", () => {
  it("derives input availability from Core exit, never working/waiting", async () => {
    let currentActivity: Activity | undefined = { working: true, waiting: true, event: "Notification", at: 10 };
    const activityOf = vi.fn(() => currentActivity);
    const read = createOrchestratorStatusReader({ getSession: async () => session(), hasViewer: () => false, activityOf, workPhaseOf: () => null });
    await expect(read(ID)).resolves.toMatchObject({ inputAvailable: true, readyForInput: true, activity: { working: true, waiting: true } });

    currentActivity = undefined;
    await expect(read(ID)).resolves.toMatchObject({ inputAvailable: true, readyForInput: true, activity: { working: false, waiting: false } });
  });

  it("reports an exited Core member as stopped even with stale activity", async () => {
    const read = createOrchestratorStatusReader({
      getSession: async () => session(true),
      hasViewer: () => false,
      activityOf: () => ({ working: true, waiting: true }),
      workPhaseOf: () => "implementing",
    });
    await expect(read(ID)).resolves.toMatchObject({ lifecycle: "stopped", inputAvailable: false, readyForInput: false, activity: { working: true } });
  });
});
