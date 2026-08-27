// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreSession } from "../../../server/session/core-session-adapter.js";
import { migrateLegacyBackgroundVisibility, visibleCoreSessions } from "../../../server/session/core-session-visibility.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

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
  origin: "interactive",
  guiToolGroups: [],
  allGuiTools: false,
});

describe("visibleCoreSessions", () => {
  it("keeps Core membership but excludes internal and background display rows", async () => {
    const background = { ...session("background"), visibility: "background" as const };
    const internal = { ...session("translation"), visibility: "internal" as const };
    await expect(visibleCoreSessions([session("user"), background, internal])).resolves.toEqual([session("user")]);
  });

  it("copies history background classifications into Core without consuming history metadata", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mulmoterminal-visibility-"));
    tempDirs.push(dir);
    const file = path.join(dir, "background-sessions.json");
    const backgroundId = "11111111-2222-4333-8444-555555555555";
    const ordinaryId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await fs.writeFile(file, JSON.stringify([backgroundId, "missing-session"]));
    const setVisibility = vi.fn(async () => undefined);

    await expect(migrateLegacyBackgroundVisibility({ list: async () => [session(backgroundId), session(ordinaryId)], setVisibility }, file)).resolves.toBe(1);
    expect(setVisibility).toHaveBeenCalledWith(backgroundId, "background");
    await expect(fs.readFile(file, "utf8")).resolves.toContain(backgroundId);
  });

  it("isolates a Core deletion racing the visibility upgrade", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mulmoterminal-visibility-"));
    tempDirs.push(dir);
    const file = path.join(dir, "background-sessions.json");
    const first = "11111111-2222-4333-8444-555555555555";
    const deleted = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await fs.writeFile(file, `${first}\n${deleted}`);

    await expect(
      migrateLegacyBackgroundVisibility(
        {
          list: async () => [session(first), session(deleted)],
          setVisibility: async (id) => {
            if (id === deleted) throw new Error("deleted concurrently");
          },
        },
        file,
      ),
    ).resolves.toBe(1);
  });
});
