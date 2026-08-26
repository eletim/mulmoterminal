// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { CoreSession } from "../../../server/session/core-session-adapter.js";
import { visibleCoreSessions } from "../../../server/session/core-session-visibility.js";

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
  resumeSource: null,
  visibility: "normal",
});

describe("visibleCoreSessions", () => {
  it("keeps Core membership but excludes internal and background display rows", async () => {
    const background = { ...session("background"), visibility: "background" as const };
    const internal = { ...session("translation"), visibility: "internal" as const };
    await expect(visibleCoreSessions([session("user"), background, internal])).resolves.toEqual([session("user")]);
  });
});
