// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { handoffCoreMemoToHistory, migrateHistoryMemosToCore, sessionMemos, sessionMemosHydrated } from "../../../server/session/registry.js";

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

  it("hands a live memo to the retained history identity only at Delete", async () => {
    await sessionMemosHydrated;
    const persist = vi.fn(async (_id: string, text: string) => text);
    await handoffCoreMemoToHistory({ id: ALREADY_CORE, memo: "Core note", resumeSource: LEGACY }, persist);
    expect(persist).toHaveBeenCalledExactlyOnceWith(LEGACY, "Core note");
  });

  it("erases stale history metadata when the live memo was cleared", async () => {
    await sessionMemosHydrated;
    const persist = vi.fn(async (_id: string, text: string) => text);
    await handoffCoreMemoToHistory({ id: ALREADY_CORE, memo: null, resumeSource: LEGACY }, persist);
    expect(persist).toHaveBeenCalledExactlyOnceWith(LEGACY, "");
  });
});
