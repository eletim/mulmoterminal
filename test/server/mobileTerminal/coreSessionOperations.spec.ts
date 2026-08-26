// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createCoreSessionOperations } from "../../../server/mobileTerminal/coreSessionOperations.js";

describe("createCoreSessionOperations", () => {
  it("maps Interrupt and Stop to Core.stop and Delete to Core.delete", async () => {
    const core = { stop: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) };
    const operations = createCoreSessionOperations(core);

    await operations.interruptSession("interrupt");
    await operations.stopSession("stop");
    await operations.deleteSession("delete");

    expect(core.stop.mock.calls).toEqual([["interrupt"], ["stop"]]);
    expect(core.delete).toHaveBeenCalledExactlyOnceWith("delete");
  });
});
