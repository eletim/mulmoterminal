import { describe, expect, it, vi } from "vitest";
import type { SessionCore } from "tmux-session-core-ts";
import { CoreSessionAdapter } from "../../../server/session/core-session-adapter.js";

const native = {
  id: "session-1",
  createdAt: new Date(1_700_000_000_000),
  attached: false,
  processId: 123,
  exited: false,
  exitCode: null,
  cols: 80,
  rows: 24,
  cwd: "/repo",
  currentCommand: "bash",
};

describe("CoreSessionAdapter", () => {
  it("reconstructs client-owned fields from Core metadata", async () => {
    const core = {
      list: vi.fn(async () => [native]),
      listMetadata: vi.fn(async () => ({ agent: "codex", title: "Fix #149", memo: "review" })),
    } as unknown as SessionCore;

    const sessions = await new CoreSessionAdapter({ core }).list();

    expect(sessions).toEqual([{ ...native, agent: "codex", title: "Fix #149", memo: "review" }]);
  });

  it("restores cwd metadata when an exited tmux pane no longer reports a cwd", async () => {
    const core = {
      get: vi.fn(async () => ({ ...native, cwd: "", exited: true })),
      listMetadata: vi.fn(async () => ({ agent: "claude", cwd: "/finished/repo" })),
    } as unknown as SessionCore;

    await expect(new CoreSessionAdapter({ core }).get(native.id)).resolves.toMatchObject({ cwd: "/finished/repo", agent: "claude", exited: true });
  });

  it("creates native membership first and stores only reconstruction metadata", async () => {
    const setMetadata = vi.fn(async () => undefined);
    const core = {
      create: vi.fn(async () => native),
      setMetadata,
      listMetadata: vi.fn(async () => ({ agent: "codex", cwd: native.cwd, title: "Fix #149" })),
    } as unknown as SessionCore;

    await new CoreSessionAdapter({ core }).create({ id: native.id, command: "codex", cwd: native.cwd, agent: "codex", title: "Fix #149" });

    expect(setMetadata.mock.calls).toEqual([
      [native.id, "agent", "codex"],
      [native.id, "cwd", native.cwd],
      [native.id, "title", "Fix #149"],
    ]);
  });

  it("routes interactive input through Core without an implicit submit", async () => {
    const input = vi.fn(async () => undefined);
    const core = { input } as unknown as SessionCore;

    await new CoreSessionAdapter({ core }).input(native.id, "\u001b[A");

    expect(input).toHaveBeenCalledWith(native.id, "\u001b[A", { submit: false });
  });

  it("reports child exit from a remain-on-exit Core pane", async () => {
    const core = {
      list: vi
        .fn()
        .mockResolvedValueOnce([native])
        .mockResolvedValueOnce([{ ...native, exited: true, exitCode: 7 }]),
    } as unknown as SessionCore;
    const adapter = new CoreSessionAdapter({ core });

    await expect(
      new Promise((resolve) => {
        adapter.watchExit(native.id, resolve, 1);
      }),
    ).resolves.toEqual({ exitCode: 7 });
    expect(core.list).toHaveBeenCalledTimes(2);
  });
});
