// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// node-pty is a native module and spawning is the whole point of the file under test, so
// the pty itself is mocked: what matters here is the ENVIRONMENT handed to it.
const nativeExitDispose = vi.fn();
const coreCreateSync = vi.hoisted(() => vi.fn());
let nativeExitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;
const spawn = vi.fn(() => ({
  pid: 1,
  onData: vi.fn(),
  onExit: vi.fn((listener: typeof nativeExitListener) => {
    nativeExitListener = listener;
    return { dispose: nativeExitDispose };
  }),
  write: vi.fn(),
  kill: vi.fn(),
}));
vi.mock("node-pty", () => ({ default: { spawn: (...args: unknown[]) => spawn(...(args as [])) } }));
const scrub = vi.fn();
vi.mock("../../../server/infra/tmux.js", () => ({
  tmuxAvailable: () => tmuxOn,
  tmuxAttachSessionArgs: (id: string) => ["attach-session", id],
  configureCoreTmuxServer: vi.fn(),
  tmuxScrubEnvNames: (names: readonly string[]) => scrub(names),
}));
let coreExitListener: ((event: { exitCode: number | null }) => void) | undefined;
const coreExitDispose = vi.fn();
vi.mock("../../../server/session/core-session-adapter.js", () => ({
  coreSessions: {
    createSync: coreCreateSync,
    watchExit: vi.fn((_id: string, listener: typeof coreExitListener) => {
      coreExitListener = listener;
      return { dispose: coreExitDispose };
    }),
  },
}));

let tmuxOn = false;

// ptySpawn stats the cwd and refuses a spawn into a directory that is not there, so this cannot
// be a literal: "/tmp" is not a directory on Windows, which failed only in the Windows job. Our
// own cwd is a directory on every platform, by definition — the same reasoning diagnoseSpawnCwd
// applies to an empty cwd.
const EXISTING_CWD = process.cwd();

const { isCoreSessionExitEvent, spawnPty, spawnTmuxViewerPty, ptySpawn, ptyWouldReattach } = await import("../../../server/session/pty-spawn.js");

const envOf = (call: number = 0): NodeJS.ProcessEnv => (spawn.mock.calls[call] as unknown as [string, string[], { env: NodeJS.ProcessEnv }])[2].env;

beforeEach(() => {
  spawn.mockClear();
  scrub.mockClear();
  nativeExitDispose.mockClear();
  coreExitDispose.mockClear();
  coreCreateSync.mockClear();
  coreExitListener = undefined;
  nativeExitListener = undefined;
  tmuxOn = false;
  process.env.ANTHROPIC_API_KEY = "sk-ant-leftover";
  process.env.MT_KEEP_ME = "kept";
});

// A leftover ANTHROPIC_API_KEY silently outranks the auth token that aims a provider
// session at its backend, and the settings `env` block can set a variable but not remove
// one. So the removal has to happen HERE — computing it and not applying it (which is
// exactly what shipped first) leaves the routing broken with no symptom until a request.
describe("spawnPty — the environment it hands the pty", () => {
  it("removes the named variables", () => {
    spawnPty("claude", [], EXISTING_CWD, ["ANTHROPIC_API_KEY"]);
    expect(envOf()).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("keeps everything else", () => {
    spawnPty("claude", [], EXISTING_CWD, ["ANTHROPIC_API_KEY"]);
    expect(envOf().MT_KEEP_ME).toBe("kept");
  });

  it("leaves the environment alone when nothing is named", () => {
    spawnPty("claude", [], EXISTING_CWD);
    expect(envOf().ANTHROPIC_API_KEY).toBe("sk-ant-leftover");
  });

  it("starts a secondary tmux viewer at the shared primary geometry", () => {
    spawnTmuxViewerPty("s1", EXISTING_CWD, { cols: 132, rows: 43 });

    const options = (spawn.mock.calls[0] as unknown as [string, string[], { cols: number; rows: number }])[2];
    expect(options).toMatchObject({ cols: 132, rows: 43 });
  });
});

// `new-session -A` returns a terminal whether it created one or picked up a survivor, so a
// caller that must not treat the second as a fresh start has to ask beforehand. What hangs on
// it: a reattached claude never re-reads the user's MCP config, so resetting its learned tool
// groups there would drop them with nothing left to relearn from.
describe("ptyWouldReattach", () => {
  it("is true only when Core reports membership and tmux is available", () => {
    tmuxOn = true;
    expect(ptyWouldReattach(true, true)).toBe(true);
    expect(ptyWouldReattach(false, true)).toBe(false);
  });

  it("is false without tmux — every spawn there starts a new process", () => {
    tmuxOn = false;
    expect(ptyWouldReattach(true, true)).toBe(false);
  });

  // Matches ptySpawn's own branch: a non-persistent spawn never consults tmux at all.
  it("is false for a non-persistent spawn", () => {
    tmuxOn = true;
    expect(ptyWouldReattach(true, false)).toBe(false);
  });
});

// The tmux pane inherits the tmux SERVER's environment rather than this one, so the scrub
// there is what actually protects it — but the non-tmux path has only this.
describe("ptySpawn — carries the removal down both paths", () => {
  it("applies it on the direct spawn", () => {
    ptySpawn("s1", "claude", [], EXISTING_CWD, false, { unset: ["ANTHROPIC_API_KEY"] });
    expect(envOf()).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("applies it on the tmux spawn too", () => {
    tmuxOn = true;
    const result = ptySpawn("s1", "claude", [], EXISTING_CWD, true, { unset: ["ANTHROPIC_API_KEY"] });
    expect(result.tmux).toBe(true);
    expect(envOf()).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("creates a Core member for a fresh persistent terminal", () => {
    tmuxOn = true;
    ptySpawn("s1", "claude", [], EXISTING_CWD, true);
    expect(coreCreateSync).toHaveBeenCalledOnce();
  });

  it("stores the history identity on the newly created Core member", () => {
    tmuxOn = true;
    ptySpawn("s2", "claude", [], EXISTING_CWD, true, { resumeSource: "s1" });
    expect(coreCreateSync).toHaveBeenCalledWith(expect.objectContaining({ id: "s2", resumeSource: "s1" }), expect.any(Object));
  });

  it("stores display classification on the newly created Core member", () => {
    tmuxOn = true;
    ptySpawn("s2", "claude", [], EXISTING_CWD, true, { visibility: "internal" });
    expect(coreCreateSync).toHaveBeenCalledWith(expect.objectContaining({ id: "s2", visibility: "internal" }), expect.any(Object));
  });

  it("attaches without creating when Core already owns the member", () => {
    tmuxOn = true;
    const result = ptySpawn("s1", "claude", [], EXISTING_CWD, true, { coreSessionExists: true });
    expect(result.reattached).toBe(true);
    expect(coreCreateSync).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith("tmux", ["attach-session", "s1"], expect.any(Object));
  });

  it("turns Core remain-on-exit into the PTY exit event used by viewer and process owners", () => {
    tmuxOn = true;
    const { term } = ptySpawn("s1", "claude", [], EXISTING_CWD, true);
    const listener = vi.fn();
    term.onExit(listener);

    coreExitListener?.({ exitCode: 9 });

    const event = listener.mock.calls[0]?.[0];
    expect(event).toEqual(expect.objectContaining({ exitCode: 9, signal: 0 }));
    expect(isCoreSessionExitEvent(event)).toBe(true);
    expect(nativeExitDispose).toHaveBeenCalledOnce();
    expect(coreExitDispose).toHaveBeenCalledOnce();
  });

  it("watches Core remain-on-exit for a secondary tmux viewer", () => {
    const term = spawnTmuxViewerPty("s1", EXISTING_CWD);
    const listener = vi.fn();
    term.onExit(listener);

    coreExitListener?.({ exitCode: 12 });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 12, signal: 0 }));
    expect(isCoreSessionExitEvent(listener.mock.calls[0]?.[0])).toBe(true);
  });

  it("does not classify a viewer tmux client exit as a Core process exit", () => {
    tmuxOn = true;
    const { term } = ptySpawn("s1", "claude", [], EXISTING_CWD, true);
    const listener = vi.fn();
    term.onExit(listener);

    nativeExitListener?.({ exitCode: 0, signal: 15 });

    const event = listener.mock.calls[0]?.[0];
    expect(isCoreSessionExitEvent(event)).toBe(false);

    coreExitListener?.({ exitCode: 7 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(isCoreSessionExitEvent(listener.mock.calls[1]?.[0])).toBe(true);
  });
});

// Stripping our own copy is not enough: a pane inherits the tmux SERVER's environment,
// and a server created by an earlier non-provider session already carries the key. The
// scrub in ensureConf only covers a server that predates this process.
describe("ptySpawn — the tmux server's own environment", () => {
  it("scrubs the names from the running server before a provider spawn", () => {
    tmuxOn = true;
    ptySpawn("s1", "claude", [], EXISTING_CWD, true, { unset: ["ANTHROPIC_API_KEY"] });
    expect(scrub).toHaveBeenCalledWith(["ANTHROPIC_API_KEY"]);
  });

  it("leaves the server alone for an ordinary session", () => {
    tmuxOn = true;
    ptySpawn("s1", "claude", [], EXISTING_CWD, true);
    expect(scrub).not.toHaveBeenCalled();
  });
});
