// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasSessionChildProcess } from "../../../server/session/child-processes.js";
import { SHELL_TASK_FINISHED_NOTIFY_MS, pollShellTask, startShellTaskWatch, stopShellTaskWatch } from "../../../server/session/shell-task-watch.js";

vi.mock("../../../server/session/child-processes.js", () => ({
  hasSessionChildProcess: vi.fn(() => false),
}));

const ID = "11111111-2222-4333-8444-555555555555";
const baseEntry = { term: { pid: 100 }, ws: null, buffer: "", cwd: "/work", active: false };
const shellEntry = { ...baseEntry, agent: "shell" } as never;
const activeShellEntry = { ...baseEntry, active: true, agent: "shell" } as never;
const claudeEntry = { ...baseEntry, agent: "claude" } as never;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(hasSessionChildProcess).mockReset().mockReturnValue(false);
});

afterEach(() => {
  stopShellTaskWatch(ID);
  vi.useRealTimers();
});

describe("pollShellTask", () => {
  it("marks a shell working when a foreground child appears", () => {
    const setWorking = vi.fn();
    const setWaiting = vi.fn();
    vi.mocked(hasSessionChildProcess).mockReturnValue(true);

    expect(pollShellTask(ID, shellEntry, { setWorking, setWaiting })).toBe(true);

    expect(setWaiting).toHaveBeenCalledWith(ID, false);
    expect(setWorking).toHaveBeenCalledWith(ID, true, "UserPromptSubmit");
  });

  it("stays silent when the running state has not changed", () => {
    const setWorking = vi.fn();
    const setWaiting = vi.fn();
    vi.mocked(hasSessionChildProcess).mockReturnValue(false);

    expect(pollShellTask(ID, shellEntry, { setWorking, setWaiting })).toBe(false);

    expect(setWaiting).not.toHaveBeenCalled();
    expect(setWorking).not.toHaveBeenCalled();
  });
});

describe("startShellTaskWatch", () => {
  it("polls shell sessions and clears working when the child process exits", () => {
    const setWorking = vi.fn();
    const setWaiting = vi.fn();
    vi.mocked(hasSessionChildProcess).mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false);

    startShellTaskWatch(ID, shellEntry, { setWorking, setWaiting });
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);

    expect(setWorking).toHaveBeenNthCalledWith(1, ID, true, "UserPromptSubmit");
    expect(setWorking).toHaveBeenNthCalledWith(2, ID, false, undefined);
  });

  it("flags a long inactive shell task as finished exactly once", () => {
    const setWorking = vi.fn();
    const setWaiting = vi.fn();
    let now = 1_000;
    vi.mocked(hasSessionChildProcess).mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValueOnce(false);

    startShellTaskWatch(ID, shellEntry, { setWorking, setWaiting, now: () => now });
    now += SHELL_TASK_FINISHED_NOTIFY_MS;
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);

    expect(setWaiting).toHaveBeenCalledWith(ID, true, "Stop");
    expect(setWorking).toHaveBeenLastCalledWith(ID, false, "Stop");
    expect(setWaiting.mock.calls.filter((call) => call[1] === true && call[2] === "Stop")).toHaveLength(1);
  });

  it("does not flag short shell tasks as finished", () => {
    const setWorking = vi.fn();
    const setWaiting = vi.fn();
    let now = 1_000;
    vi.mocked(hasSessionChildProcess).mockReturnValueOnce(true).mockReturnValueOnce(false);

    startShellTaskWatch(ID, shellEntry, { setWorking, setWaiting, now: () => now });
    now += SHELL_TASK_FINISHED_NOTIFY_MS - 1;
    vi.advanceTimersByTime(1000);

    expect(setWaiting).not.toHaveBeenCalledWith(ID, true, "Stop");
    expect(setWorking).toHaveBeenLastCalledWith(ID, false, undefined);
  });

  it("does not flag an actively viewed shell task as finished", () => {
    const setWorking = vi.fn();
    const setWaiting = vi.fn();
    let now = 1_000;
    vi.mocked(hasSessionChildProcess).mockReturnValueOnce(true).mockReturnValueOnce(false);

    startShellTaskWatch(ID, activeShellEntry, { setWorking, setWaiting, now: () => now });
    now += SHELL_TASK_FINISHED_NOTIFY_MS;
    vi.advanceTimersByTime(1000);

    expect(setWaiting).not.toHaveBeenCalledWith(ID, true, "Stop");
    expect(setWorking).toHaveBeenLastCalledWith(ID, false, undefined);
  });

  it("does not watch agent launchers", () => {
    const setWorking = vi.fn();
    const setWaiting = vi.fn();

    startShellTaskWatch(ID, claudeEntry, { setWorking, setWaiting });
    vi.advanceTimersByTime(5000);

    expect(hasSessionChildProcess).not.toHaveBeenCalled();
    expect(setWorking).not.toHaveBeenCalled();
  });

  it("stops polling when stopped", () => {
    const setWorking = vi.fn();
    const setWaiting = vi.fn();
    startShellTaskWatch(ID, shellEntry, { setWorking, setWaiting });
    vi.mocked(hasSessionChildProcess).mockClear();

    stopShellTaskWatch(ID);
    vi.advanceTimersByTime(5000);

    expect(hasSessionChildProcess).not.toHaveBeenCalled();
  });
});
