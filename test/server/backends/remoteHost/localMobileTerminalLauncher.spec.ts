// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markDevTerminalSession: vi.fn(),
  markUnplacedSession: vi.fn(),
  registeredGuiMcpGroups: vi.fn(),
  claimRelease: vi.fn(),
  claimLaunch: vi.fn(),
  worktreeOccupancy: vi.fn(),
}));

vi.mock("../../../../server/session/registry.js", () => ({
  markDevTerminalSession: mocks.markDevTerminalSession,
  markUnplacedSession: mocks.markUnplacedSession,
}));

vi.mock("../../../../server/infra/gui-mcp-registration.js", () => ({
  registeredGuiMcpGroups: mocks.registeredGuiMcpGroups,
}));

vi.mock("../../../../server/session/worktree-session-limit.js", () => ({
  claimLaunch: mocks.claimLaunch,
  worktreeOccupancy: mocks.worktreeOccupancy,
}));

const { createLocalMobileTerminalCreator } = await import("../../../../server/backends/remoteHost/localMobileTerminalLauncher.js");

const entry = () => ({}) as never;

function deps() {
  return {
    spawnClaudePty: vi.fn(() => entry()),
    spawnCodexPty: vi.fn(() => entry()),
    spawnAntigravityPty: vi.fn(() => entry()),
    spawnLauncherPty: vi.fn(() => entry()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimLaunch.mockReturnValue({ contended: false, release: mocks.claimRelease });
  mocks.worktreeOccupancy.mockResolvedValue({ isWorktree: false, session: null });
  mocks.registeredGuiMcpGroups.mockResolvedValue(["render"]);
});

describe("createLocalMobileTerminalCreator", () => {
  it("starts a shell session directly without requiring a browser subscriber", async () => {
    const d = deps();
    const create = createLocalMobileTerminalCreator(d);
    const result = await create("shell", "/repo");

    expect(result).toEqual({ ok: true, sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    if (!result.ok) throw new Error("expected create to succeed");
    expect(d.spawnLauncherPty).toHaveBeenCalledWith(result.sessionId, null, process.env.SHELL || "/bin/sh", "/repo");
    expect(mocks.markDevTerminalSession).toHaveBeenCalledWith(result.sessionId, "/repo");
    expect(mocks.worktreeOccupancy).not.toHaveBeenCalled();
  });

  it("starts a codex session with the directory's registered GUI groups and marks it unplaced", async () => {
    const d = deps();
    const create = createLocalMobileTerminalCreator(d);
    const result = await create("codex", "/repo");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected create to succeed");
    expect(d.spawnCodexPty).toHaveBeenCalledWith(result.sessionId, null, null, "/repo", false, { mcpGroups: ["render"] });
    expect(mocks.markUnplacedSession).toHaveBeenCalledWith(result.sessionId, "codex");
    expect(mocks.claimRelease).toHaveBeenCalledOnce();
  });

  it("returns a retryable error when the spawn is refused", async () => {
    const d = deps();
    d.spawnClaudePty.mockImplementation(() => {
      throw new Error("claude not found");
    });
    const create = createLocalMobileTerminalCreator(d);

    await expect(create("claude", "/repo")).resolves.toEqual({ ok: false, error: "claude not found" });
    expect(mocks.markUnplacedSession).not.toHaveBeenCalled();
  });

  it("refuses a second agent launch into a contended managed worktree before spawning", async () => {
    mocks.claimLaunch.mockReturnValue({ contended: true, release: mocks.claimRelease });
    mocks.worktreeOccupancy.mockResolvedValue({ isWorktree: true, session: null });
    const d = deps();
    const create = createLocalMobileTerminalCreator(d);

    await expect(create("antigravity", "/repo")).resolves.toEqual({
      ok: false,
      error: "a session is already starting in this worktree — a worktree runs one agent session",
    });
    expect(d.spawnAntigravityPty).not.toHaveBeenCalled();
    expect(mocks.claimRelease).toHaveBeenCalledOnce();
  });
});
