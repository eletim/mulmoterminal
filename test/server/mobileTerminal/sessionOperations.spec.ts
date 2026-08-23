// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalSessionOperations } from "../../../server/mobileTerminal/sessionOperations.js";
import { sessionLifecycleRecords } from "../../../server/session/session-lifecycle-records.js";

beforeEach(() => {
  sessionLifecycleRecords.clear();
});

describe("createTerminalSessionOperations", () => {
  it("interrupts by writing ctrl-c to the runtime session", () => {
    const writeToSession = vi.fn(() => true);
    const ops = createTerminalSessionOperations({
      writeToSession,
      reapSession: vi.fn(),
      hasTmux: vi.fn(() => false),
      killTmux: vi.fn(),
    });

    expect(ops.interruptSession("s1")).toBe(true);
    expect(writeToSession).toHaveBeenCalledWith("s1", "\x03");
  });

  it("records stopped when mobile stop kills a tmux-only survivor", () => {
    const ops = createTerminalSessionOperations({
      writeToSession: vi.fn(),
      reapSession: vi.fn(),
      hasTmux: vi.fn(() => true),
      killTmux: vi.fn(),
    });

    ops.stopSession("s1");

    expect(sessionLifecycleRecords.get("s1")).toMatchObject({
      id: "s1",
      lifecycle: "stopped",
    });
  });

  it("does not create a lifecycle row for a missing non-tmux session", () => {
    const ops = createTerminalSessionOperations({
      writeToSession: vi.fn(),
      reapSession: vi.fn(),
      hasTmux: vi.fn(() => false),
      killTmux: vi.fn(),
    });

    ops.stopSession("missing");

    expect(sessionLifecycleRecords.has("missing")).toBe(false);
  });
});
