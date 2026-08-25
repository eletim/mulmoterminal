// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { codexRolloutIds, devTerminalSessions } from "../../../server/session/registry.js";
import { resumableSessionPredicate } from "../../../server/session/resumable-sessions.js";
import { deletedSessionRecordIds, sessionLifecycleRecords } from "../../../server/session/session-lifecycle-records.js";

const SESSION = "11111111-1111-4111-8111-111111111111";
const ROLLOUT = "22222222-2222-4222-8222-222222222222";

describe("resumableSessionPredicate", () => {
  let codexHome: string;
  let previousCodexHome: string | undefined;

  beforeEach(() => {
    previousCodexHome = process.env.CODEX_HOME;
    codexHome = mkdtempSync(path.join(tmpdir(), "mt-codex-resume-"));
    process.env.CODEX_HOME = codexHome;
    sessionLifecycleRecords.clear();
    deletedSessionRecordIds.clear();
    devTerminalSessions.add(SESSION);
    codexRolloutIds.set(SESSION, ROLLOUT);
  });

  afterEach(() => {
    devTerminalSessions.delete(SESSION);
    codexRolloutIds.delete(SESSION);
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    rmSync(codexHome, { recursive: true, force: true });
  });

  it("treats a mapped Codex rollout as resumable for the browser-facing session id", async () => {
    const dir = path.join(codexHome, "sessions", "2026", "07", "08");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `rollout-2026-07-08T00-00-00-${ROLLOUT}.jsonl`),
      JSON.stringify({ type: "session_meta", payload: { id: ROLLOUT, cwd: "/repo" } }) + "\n",
    );

    const isResumable = await resumableSessionPredicate();

    expect(isResumable(SESSION)).toBe(true);
  });

  it("lets a stopped tombstone suppress legacy grid and rollout resumability", async () => {
    sessionLifecycleRecords.set(SESSION, { id: SESSION, lifecycle: "stopped", agent: "codex", cwd: "/repo", createdAt: 10, updatedAt: 10 });

    const isResumable = await resumableSessionPredicate();

    expect(isResumable(SESSION)).toBe(false);
  });

  it("lets a deletion tombstone suppress legacy grid and rollout resumability", async () => {
    deletedSessionRecordIds.add(SESSION);

    const isResumable = await resumableSessionPredicate();

    expect(isResumable(SESSION)).toBe(false);
  });
});
