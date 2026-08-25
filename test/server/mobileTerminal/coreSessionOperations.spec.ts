// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createCoreSessionOperations } from "../../../server/mobileTerminal/coreSessionOperations.js";

describe("createCoreSessionOperations", () => {
  it("uses Core.stop for Interrupt and Core.delete for the existing Mobile Stop/Delete actions", async () => {
    const reap = vi.fn();
    const core = { stop: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) };
    const operations = createCoreSessionOperations(reap, core);

    await operations.interruptSession("interrupt");
    await operations.stopSession("stop");
    await operations.deleteSession("delete");

    expect(core.stop).toHaveBeenCalledExactlyOnceWith("interrupt");
    expect(core.delete.mock.calls).toEqual([["stop"], ["delete"]]);
    expect(reap.mock.calls).toEqual([["stop"], ["delete"]]);
  });
});
