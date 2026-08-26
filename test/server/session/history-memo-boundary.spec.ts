// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateHistoryMemosToCore, sessionMemos, sessionMemosHydrated } from "../../../server/session/registry.js";

const LEGACY = "11111111-2222-4333-8444-555555555555";
const ALREADY_CORE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

afterEach(() => sessionMemos.clear());

describe("history/live memo boundary", () => {
  it("copies a legacy live memo into Core without mirroring Core-owned values", async () => {
    await sessionMemosHydrated;
    sessionMemos.set(LEGACY, "move me");
    sessionMemos.set(ALREADY_CORE, "stale history value");
    const setCoreMemo = vi.fn(async () => undefined);

    await expect(
      migrateHistoryMemosToCore(
        [
          { id: LEGACY, memo: null },
          { id: ALREADY_CORE, memo: "Core wins" },
        ],
        setCoreMemo,
      ),
    ).resolves.toBe(1);

    expect(setCoreMemo).toHaveBeenCalledExactlyOnceWith(LEGACY, "move me");
    expect(sessionMemos.get(ALREADY_CORE)).toBe("stale history value");
  });

  it("isolates a Core deletion racing the one-way migration", async () => {
    await sessionMemosHydrated;
    sessionMemos.set(LEGACY, "move me");

    await expect(
      migrateHistoryMemosToCore([{ id: LEGACY, memo: null }], async () => {
        throw new Error("deleted concurrently");
      }),
    ).resolves.toBe(0);
  });
});
