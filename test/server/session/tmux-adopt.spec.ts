// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createAdoptingTerminalWriter } from "../../../server/session/tmux-adopt.js";

const ID = "11111111-2222-4333-8444-555555555555";

const entry = () => ({ term: { write: vi.fn() } }) as never;

describe("createAdoptingTerminalWriter", () => {
  it("writes to an already-live PTY without spawning", () => {
    const live = entry();
    const spawnLauncherPty = vi.fn();
    const write = createAdoptingTerminalWriter({
      entryOf: () => live,
      hasTmux: () => true,
      cwdOf: () => "/work",
      spawnLauncherPty,
      commandOf: () => "/bin/sh",
    });

    expect(write(ID, "echo ok\r")).toBe(true);

    expect((live as { term: { write: ReturnType<typeof vi.fn> } }).term.write).toHaveBeenCalledWith("echo ok\r");
    expect(spawnLauncherPty).not.toHaveBeenCalled();
  });

  it("adopts a tmux-only survivor before writing", () => {
    const adopted = entry();
    const spawnLauncherPty = vi.fn(() => adopted);
    const write = createAdoptingTerminalWriter({
      entryOf: () => undefined,
      hasTmux: () => true,
      cwdOf: () => "/remembered",
      spawnLauncherPty,
      commandOf: () => "/bin/bash",
    });

    expect(write(ID, "date\r")).toBe(true);

    expect(spawnLauncherPty).toHaveBeenCalledWith(ID, null, "/bin/bash", "/remembered");
    expect((adopted as { term: { write: ReturnType<typeof vi.fn> } }).term.write).toHaveBeenCalledWith("date\r");
  });

  it("does not spawn a new shell when no tmux session exists", () => {
    const spawnLauncherPty = vi.fn();
    const write = createAdoptingTerminalWriter({
      entryOf: () => undefined,
      hasTmux: () => false,
      cwdOf: () => "/work",
      spawnLauncherPty,
      commandOf: () => "/bin/sh",
    });

    expect(write(ID, "date\r")).toBe(false);
    expect(spawnLauncherPty).not.toHaveBeenCalled();
  });

  it("reports failure when adoption or write fails", () => {
    const writeThrow = createAdoptingTerminalWriter({
      entryOf: () =>
        ({
          term: {
            write: () => {
              throw new Error("write failed");
            },
          },
        }) as never,
      hasTmux: () => false,
      cwdOf: () => "/work",
      spawnLauncherPty: () => {
        throw new Error("should not spawn");
      },
      commandOf: () => "/bin/sh",
    });
    const adoptThrow = createAdoptingTerminalWriter({
      entryOf: () => undefined,
      hasTmux: () => true,
      cwdOf: () => "/work",
      spawnLauncherPty: () => {
        throw new Error("spawn failed");
      },
      commandOf: () => "/bin/sh",
    });

    expect(writeThrow(ID, "x")).toBe(false);
    expect(adoptThrow(ID, "x")).toBe(false);
  });
});
