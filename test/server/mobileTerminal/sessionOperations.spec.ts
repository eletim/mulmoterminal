// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalSessionOperations } from "../../../server/mobileTerminal/sessionOperations.js";
import { deletedSessionRecordIds, sessionLifecycleRecords } from "../../../server/session/session-lifecycle-records.js";

const SESSION = "11111111-1111-1111-1111-111111111111";
const MISSING = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  sessionLifecycleRecords.clear();
  deletedSessionRecordIds.clear();
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

  it("records deletion when mobile stop kills a tmux-only survivor", () => {
    const ops = createTerminalSessionOperations({
      writeToSession: vi.fn(),
      reapSession: vi.fn(),
      hasTmux: vi.fn(() => true),
      killTmux: vi.fn(),
    });

    ops.stopSession(SESSION);

    expect(deletedSessionRecordIds.has(SESSION)).toBe(true);
  });

  it("records deletion for a missing non-tmux session", () => {
    const ops = createTerminalSessionOperations({
      writeToSession: vi.fn(),
      reapSession: vi.fn(),
      hasTmux: vi.fn(() => false),
      killTmux: vi.fn(),
    });

    ops.stopSession(MISSING);

    expect(sessionLifecycleRecords.has(MISSING)).toBe(false);
    expect(deletedSessionRecordIds.has(MISSING)).toBe(true);
  });
});
