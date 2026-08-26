// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
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

  it("still reaps local runtime when Core reports the session missing", async () => {
    const reapLocalSession = vi.fn();

    await expect(
      forceDeleteTerminalSession("already-gone", {
        reapLocalSession,
        deleteCoreSession: async () => Promise.reject(new Error("session not found")),
      }),
    ).rejects.toThrow("session not found");

    expect(reapLocalSession).toHaveBeenCalledExactlyOnceWith("already-gone");
  });
});
