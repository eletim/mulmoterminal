// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { hasDescendantProcess, parsePsPidPpid, sessionRootPid } from "../../../server/session/child-processes.js";
import { tmuxPanePid } from "../../../server/infra/tmux.js";

vi.mock("../../../server/infra/tmux.js", () => ({ tmuxPanePid: vi.fn(() => null) }));

describe("parsePsPidPpid", () => {
  it("reads ps pid/ppid rows", () => {
    expect(parsePsPidPpid(" 10 1\n 20 10\n")).toEqual([
      { pid: 10, ppid: 1 },
      { pid: 20, ppid: 10 },
    ]);
  });

  it("drops malformed rows", () => {
    expect(parsePsPidPpid("PID PPID\nx 1\n2 -1\n3 0\n")).toEqual([{ pid: 3, ppid: 0 }]);
  });
});

describe("hasDescendantProcess", () => {
  it("detects direct and nested children", () => {
    const rows = [
      { pid: 10, ppid: 1 },
      { pid: 20, ppid: 10 },
      { pid: 30, ppid: 20 },
    ];
    expect(hasDescendantProcess(10, rows)).toBe(true);
    expect(hasDescendantProcess(20, rows)).toBe(true);
  });

  it("does not count the root process itself as child work", () => {
    expect(hasDescendantProcess(10, [{ pid: 10, ppid: 1 }])).toBe(false);
  });
});

describe("sessionRootPid", () => {
  it("uses the PTY pid for non-tmux sessions", () => {
    expect(sessionRootPid("s1", { term: { pid: 123 } } as never)).toBe(123);
  });

  it("uses tmux pane pid for persistent sessions and cold reconnects", () => {
    vi.mocked(tmuxPanePid).mockReturnValue(456);
    expect(sessionRootPid("s1", { tmux: true, term: { pid: 123 } } as never)).toBe(456);
    expect(sessionRootPid("s1", undefined)).toBe(456);
  });
});
