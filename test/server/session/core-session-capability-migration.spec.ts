// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateLegacyGuiCapabilities } from "../../../server/session/core-session-capability-migration.js";

const ID = "11111111-2222-4333-8444-555555555555";
const STALE = "99999999-8888-4777-8666-555555555555";
const dirs: string[] = [];

afterEach(async () => Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))));

describe("legacy GUI capability migration", () => {
  it("moves only current Core members and retires the append-only logs", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-capability-migration-"));
    dirs.push(home);
    await fs.writeFile(path.join(home, "session-tool-groups.json"), `${ID} render\n${STALE} external`);
    await fs.writeFile(path.join(home, "all-tools-sessions.json"), `${ID}\n${STALE}`);
    const learnGuiCapabilities = vi.fn(async () => ({ groups: ["render"], allTools: true, changed: true }));
    const core = { list: async () => [{ id: ID }], learnGuiCapabilities } as never;

    await expect(migrateLegacyGuiCapabilities(core, home)).resolves.toBe(1);
    expect(learnGuiCapabilities).toHaveBeenCalledExactlyOnceWith(ID, ["render"], true);
    await expect(fs.stat(path.join(home, "session-tool-groups.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(home, "all-tools-sessions.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps legacy files when Core migration fails so restart can retry", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-capability-migration-"));
    dirs.push(home);
    const file = path.join(home, "session-tool-groups.json");
    await fs.writeFile(file, `${ID} media`);
    const core = { list: async () => [{ id: ID }], learnGuiCapabilities: async () => Promise.reject(new Error("Core unavailable")) } as never;

    await expect(migrateLegacyGuiCapabilities(core, home)).rejects.toThrow("Core unavailable");
    await expect(fs.readFile(file, "utf8")).resolves.toContain(ID);
  });
});
