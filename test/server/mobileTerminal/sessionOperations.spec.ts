// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTerminalSessionOperations } from "../../../server/mobileTerminal/sessionOperations.js";

describe("createTerminalSessionOperations", () => {
  it("delegates interrupt to Core", async () => {
    const interrupt = vi.fn(async () => undefined);
    const ops = createTerminalSessionOperations({ interrupt, stop: vi.fn(), delete: vi.fn() });
    await ops.interruptSession("s1");
    expect(interrupt).toHaveBeenCalledWith("s1");
  });

  it("delegates the Mobile stop and delete contracts to their injected Core operations", async () => {
    const stop = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const ops = createTerminalSessionOperations({ interrupt: vi.fn(), stop, delete: remove });
    await ops.stopSession("s1");
    await ops.deleteSession("s1");
    expect(stop).toHaveBeenCalledWith("s1");
    expect(remove).toHaveBeenCalledWith("s1");
  });
});
