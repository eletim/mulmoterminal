// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { CoreSession } from "../../../server/session/core-session-adapter.js";
import { visibleCoreSessions } from "../../../server/session/core-session-visibility.js";
import { hiddenSessions, translationWorkerIds } from "../../../server/session/registry.js";

const session = (id: string): CoreSession => ({
  id,
  createdAt: new Date(1_700_000_000_000),
  cwd: "/repo",
  currentCommand: "sh",
  processId: 123,
  exited: false,
  exitCode: null,
  attached: false,
  cols: 80,
  rows: 24,
  agent: "shell",
  title: null,
  memo: null,
});

afterEach(() => {
  hiddenSessions.clear();
  translationWorkerIds.clear();
});

describe("visibleCoreSessions", () => {
  it("keeps Core membership but excludes internal and background display rows", async () => {
    hiddenSessions.add("background");
    translationWorkerIds.add("translation");

    await expect(visibleCoreSessions([session("user"), session("background"), session("translation")])).resolves.toEqual([session("user")]);
  });
});
