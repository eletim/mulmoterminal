// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateLegacyScheduledOrigins, removeRetiredSessionStateFiles } from "../../../server/session/core-session-origin-migration.js";

const ID = "11111111-2222-4333-8444-555555555555";
const STALE = "99999999-8888-4777-8666-555555555555";
const dirs: string[] = [];

afterEach(async () => Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))));

describe("legacy Backend session state retirement", () => {
  it("moves scheduled classification for live members into Core and drops stale ids", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-origin-migration-"));
    dirs.push(home);
    const file = path.join(home, "user-scheduled-sessions.json");
    await fs.writeFile(file, `${ID}\n${STALE}`);
    const setOrigin = vi.fn(async () => undefined);
    const core = { list: async () => [{ id: ID }], setOrigin } as never;

    await expect(migrateLegacyScheduledOrigins(core, home)).resolves.toBe(1);
    expect(setOrigin).toHaveBeenCalledExactlyOnceWith(ID, "scheduled");
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes obsolete activity and Codex duplicate files", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-state-retirement-"));
    dirs.push(home);
    await Promise.all(["activity-state.json", "codex-rollout-ids.log"].map((name) => fs.writeFile(path.join(home, name), "stale")));

    await removeRetiredSessionStateFiles(home);

    await Promise.all(
      ["activity-state.json", "codex-rollout-ids.log"].map((name) => expect(fs.stat(path.join(home, name))).rejects.toMatchObject({ code: "ENOENT" })),
    );
  });
});
