// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CoreSessionNotFoundError } from "../../../server/session/core-session-adapter.js";
import { forceDeleteTerminalSession } from "../../../server/session/terminal-deletion.js";

describe("forceDeleteTerminalSession", () => {
  it("delegates canonical membership deletion to Core then reaps local runtime", async () => {
    const calls: string[] = [];

    await forceDeleteTerminalSession("session-1", {
      reapLocalSession: (id) => calls.push(`reap:${id}`),
      deleteCoreSession: async (id) => {
        calls.push(`core.delete:${id}`);
      },
    });

    expect(calls).toEqual(["core.delete:session-1", "reap:session-1"]);
  });

  it("does not consult working, provider, or runtime state before deleting", async () => {
    const deleteCoreSession = vi.fn(async () => undefined);

    await forceDeleteTerminalSession("dead-or-disconnected", {
      reapLocalSession: vi.fn(),
      deleteCoreSession,
    });

    expect(deleteCoreSession).toHaveBeenCalledExactlyOnceWith("dead-or-disconnected");
  });

  it("treats already-missing Core membership as successful and still reaps local runtime", async () => {
    const reapLocalSession = vi.fn();

    await expect(
      forceDeleteTerminalSession("already-gone", {
        reapLocalSession,
        deleteCoreSession: async () => Promise.reject(new CoreSessionNotFoundError("already-gone")),
      }),
    ).resolves.toBeUndefined();

    expect(reapLocalSession).toHaveBeenCalledExactlyOnceWith("already-gone");
  });

  it("still reaps local runtime but reports unexpected Core deletion failures", async () => {
    const reapLocalSession = vi.fn();

    await expect(
      forceDeleteTerminalSession("broken", {
        reapLocalSession,
        deleteCoreSession: async () => Promise.reject(new Error("tmux unavailable")),
      }),
    ).rejects.toThrow("tmux unavailable");

    expect(reapLocalSession).toHaveBeenCalledExactlyOnceWith("broken");
  });
});
