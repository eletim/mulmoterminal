// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import { createConnectionHandlers, handleCommandFrame, releaseAllViewers, releaseViewer } from "../../../server/session/pty-connection.js";
import type { PtyEntry } from "../../../server/session/types.js";
import { activity } from "../../../server/session/activity-store.js";
import { isViewerActive, registerSecondaryViewer, viewerPtys } from "../../../server/session/viewer-state.js";
import { registerCompletionHook, runCompletionHook, unregisterCompletionHook } from "../../../server/session/completion-hooks.js";

const OPEN = 1;
const CLOSED = 3;
const SESSION = "11111111-2222-3333-4444-555555555555";

// Records what the PTY and the socket were asked to do, so a frame's effect can be
// asserted without a real terminal or connection.
function fakeTerm() {
  const writes: string[] = [];
  const resizes: Array<[number, number]> = [];
  return {
    writes,
    resizes,
    term: {
      pid: 4242,
      kill: vi.fn(),
      write: (d: string) => {
        writes.push(d);
      },
      resize: (cols: number, rows: number) => {
        resizes.push([cols, rows]);
      },
    },
  };
}

function fakeSocket(readyState = OPEN) {
  const sent: string[] = [];
  let closed = 0;
  return {
    sent,
    closeCount: () => closed,
    parsed: () => sent.map((s) => JSON.parse(s)),
    ws: {
      readyState,
      OPEN,
      send: (d: string) => {
        sent.push(d);
      },
      close: () => {
        closed++;
      },
    },
  };
}

function setup(terminalModes: readonly number[] = []) {
  const calls: string[] = [];
  const currentEntries = new Map<string, PtyEntry>();
  // Keep the old Core/send-keys route present at runtime so these tests prove interactive input
  // never crosses into pane injection again (#193).
  const paneInput = vi.fn(async () => undefined);
  const viewport = vi.fn(async () => ({
    content: "screen",
    cursor: "cursor" as never,
    live: true,
    cols: 80,
    screenRows: 24,
    viewportRows: 24,
    historyRows: 0,
    historyLimit: 20000,
    clamped: false,
    rebased: false,
  }));
  const scroll = vi.fn(async () => ({ kind: "application" as const }));
  const resize = vi.fn(async (id: string, cols: number, rows: number) => {
    calls.push(`resize:${id}:${cols}x${rows}`);
  });
  const deps: Parameters<typeof createConnectionHandlers>[0] & { input: typeof paneInput } = {
    input: paneInput,
    viewport,
    scroll,
    resize,
    setWaiting: (id, waiting) => calls.push(`setWaiting:${id}:${waiting}`),
    releaseViewer: (id) => calls.push(`releaseViewer:${id}`),
    terminalModesOf: (id) => {
      calls.push(`terminalModes:${id}`);
      return terminalModes;
    },
    redrawTerminal: (id, clientPid) => calls.push(`redraw:${id}:${clientPid}`),
    checkTerminalSize: (id, { cols, rows }) => calls.push(`sizeCheck:${id}:${cols}x${rows}`),
    recheckTerminalSize: (id) => calls.push(`sizeRecheck:${id}`),
    cancelTerminalSizeCheck: (id) => calls.push(`sizeCheckCancel:${id}`),
    currentEntryOf: (id) => currentEntries.get(id),
  };
  const handlers = createConnectionHandlers(deps);
  return { ...handlers, calls, currentEntries, paneInput, viewport, scroll, resize };
}

// PtyEntry carries fields these handlers never touch; the fakes model the ones they do.
function entryWith(over: Partial<PtyEntry> = {}) {
  const { term } = fakeTerm();
  return { term, ws: null, buffer: "", cwd: "/ws", active: false, agent: "claude", ...over } as unknown as PtyEntry;
}

describe("handleClientFrame", () => {
  const frame = (o: unknown) => JSON.stringify(o);

  it.each([
    ["ordinary keyboard input", "ls\r"],
    ["ESC", "\x1b"],
    ["NUL", "\0"],
    ["UTF-8", "\u65e5\u672c\u8a9e\ud83d\ude80"],
    ["bracketed paste", "\x1b[200~first\nsecond\x1b[201~"],
    ["an SGR mouse press", "\x1b[<0;95;14M"],
    ["an SGR mouse release", "\x1b[<0;95;14m"],
  ])("writes %s unchanged to the attached terminal client, never to the pane", (_label, data) => {
    const { handleClientFrame, paneInput } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "input", data }), SESSION);
    expect(t.writes).toEqual([data]);
    expect(paneInput).not.toHaveBeenCalled();
  });

  it.each(["claude", "codex", "shell"] as const)("uses the same attached-client input path for %s sessions", (agent) => {
    const { handleClientFrame, paneInput } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ agent, term: t.term as never, ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "input", data: "echo ok\r" }), SESSION);
    expect(t.writes).toEqual(["echo ok\r"]);
    expect(paneInput).not.toHaveBeenCalled();
  });

  it("maps a browser viewport request to Core without exposing capture-pane", async () => {
    const { handleClientFrame, viewport } = setup([1049, 1003, 1006]);
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "viewport", requestId: 1, rows: 30 }), SESSION);
    await vi.waitFor(() => expect(s.parsed()).toContainEqual(expect.objectContaining({ type: "viewport" })));
    expect(viewport).toHaveBeenCalledWith(SESSION, { target: { kind: "live" }, rows: 30, format: "ansi" });
    const response = s.parsed().find((value) => value.type === "viewport");
    expect(response?.viewport.restore).toContain(`${String.fromCharCode(0x1b)}[?1049l`);
    expect(response?.viewport.restore).toContain(`${String.fromCharCode(0x1b)}[?1049h`);
    expect(response?.viewport.content).toBe("screen");
  });

  it("waits for the preceding Core resize before capturing a viewport", async () => {
    let finishResize: (() => void) | undefined;
    const resizePending = new Promise<void>((resolve) => {
      finishResize = resolve;
    });
    const { handleClientFrame, resize, viewport } = setup();
    resize.mockReturnValueOnce(resizePending);
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never });

    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 120, rows: 40 }), SESSION);
    handleClientFrame(entry, s.ws as never, frame({ type: "viewport", requestId: 3, rows: 40 }), SESSION);
    await Promise.resolve();
    expect(viewport).not.toHaveBeenCalled();

    finishResize?.();
    await vi.waitFor(() => expect(viewport).toHaveBeenCalledOnce());
    expect(s.parsed()).toContainEqual(expect.objectContaining({ type: "viewport", requestId: 3 }));
  });

  it("waits for the preceding Core resize before routing scroll intent", async () => {
    let finishResize: (() => void) | undefined;
    const resizePending = new Promise<void>((resolve) => {
      finishResize = resolve;
    });
    const { handleClientFrame, resize, scroll } = setup();
    resize.mockReturnValueOnce(resizePending);
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never });

    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 120, rows: 40 }), SESSION);
    handleClientFrame(entry, s.ws as never, frame({ type: "scroll", requestId: 4, direction: "up", lines: 3, rows: 40 }), SESSION);
    await Promise.resolve();
    expect(scroll).not.toHaveBeenCalled();

    finishResize?.();
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledOnce());
    expect(s.parsed()).toContainEqual({ type: "scroll-result", requestId: 4, result: { kind: "application" } });
  });

  it("restores current modes when a scroll result returns to live", async () => {
    const { handleClientFrame, scroll } = setup([1049, 1003]);
    scroll.mockResolvedValueOnce({
      kind: "viewport",
      viewport: {
        content: "live screen",
        cursor: "live" as never,
        live: true,
        cols: 80,
        screenRows: 24,
        viewportRows: 24,
        historyRows: 100,
        historyLimit: 20_000,
        clamped: false,
        rebased: false,
      },
    } as never);
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "scroll", requestId: 2, direction: "down", lines: 4, rows: 30 }), SESSION);

    await vi.waitFor(() => expect(s.parsed()).toContainEqual(expect.objectContaining({ type: "scroll-result" })));
    const response = s.parsed().find((value) => value.type === "scroll-result");
    expect(response?.result.viewport.restore).toContain(`${String.fromCharCode(0x1b)}[?1049l`);
    expect(response?.result.viewport.restore).toContain(`${String.fromCharCode(0x1b)}[?1049h`);
    expect(response?.result.viewport.content).toBe("live screen");
  });

  it("passes only generic direction, rows and cell intent to Core.scroll", async () => {
    const { handleClientFrame, scroll } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never });
    handleClientFrame(
      entry,
      s.ws as never,
      frame({ type: "scroll", requestId: 1, cursor: "opaque", direction: "up", lines: 4, rows: 30, cell: { column: 12, row: 8 } }),
      SESSION,
    );
    await vi.waitFor(() => expect(s.parsed()).toContainEqual({ type: "scroll-result", requestId: 1, result: { kind: "application" } }));
    expect(scroll).toHaveBeenCalledWith(SESSION, {
      cursor: "opaque",
      direction: "up",
      lines: 4,
      rows: 30,
      cell: { column: 12, row: 8 },
      format: "ansi",
    });
  });

  it("resizes on a valid resize frame", () => {
    const { handleClientFrame, calls } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 100, rows: 40 }), SESSION);
    expect(calls).toContain(`resize:${SESSION}:100x40`);
  });

  // The redraw waits for this frame on purpose: it is where the client reports the size it
  // actually settled at, so the repaint that follows is drawn at the right geometry.
  it("asks for the redraw on the first resize after a reattach, and only that one", async () => {
    const { reattachPty, handleClientFrame, calls } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: null, buffer: "x", tmux: true });
    reattachPty(entry, s.ws as never, SESSION);
    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 100, rows: 30 }), SESSION);
    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 120, rows: 40 }), SESSION);
    await vi.waitFor(() => expect(calls).toContain(`resize:${SESSION}:120x40`));
    expect(calls).toContain(`resize:${SESSION}:100x30`);
    // The pid is the pty's own — it is what picks OUR tmux client out of a session that several
    // servers may have attached (#1099 review).
    expect(calls.filter((c) => c.startsWith("redraw:"))).toEqual([`redraw:${SESSION}:4242`]);
  });

  it("never asks for a redraw on a session that was not reattached", () => {
    // A fresh spawn's client gets the real screen from the live stream; a repaint would be noise.
    const { handleClientFrame, calls } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never, tmux: true });
    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 100, rows: 30 }), SESSION);
    expect(calls.filter((c) => c.startsWith("redraw:"))).toEqual([]);
  });

  // Unlike the redraw, this runs on EVERY resize: a window can fall out of step with its client
  // long after the reattach, and only a resize frame tells us what the client thinks it is (#957).
  it("checks the tmux window size on every resize of a tmux session", () => {
    const { handleClientFrame, calls } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never, tmux: true });
    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 100, rows: 30 }), SESSION);
    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 120, rows: 40 }), SESSION);
    expect(calls.filter((c) => c.startsWith("sizeCheck:"))).toEqual([`sizeCheck:${SESSION}:100x30`, `sizeCheck:${SESSION}:120x40`]);
  });

  it("never checks the window size of a session that is not in tmux", () => {
    // No tmux, no window to disagree with — the pty IS the terminal.
    const { handleClientFrame, calls } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 100, rows: 30 }), SESSION);
    expect(calls.filter((c) => c.startsWith("sizeCheck:"))).toEqual([]);
  });

  it("ignores a resize outside the allowed bounds", () => {
    const { handleClientFrame } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 0, rows: 99999 }), SESSION);
    expect(t.resizes).toEqual([]);
  });

  it("ignores a stale socket close after its transient pty was removed", () => {
    const { handleClientClose, currentEntries, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never });
    handleClientClose(entry, s.ws as never, SESSION);

    expect(calls).toEqual([]);
    expect(currentEntries.has(SESSION)).toBe(false);
  });

  it("marks an activated pane read, and only tracks the flag when deactivated", () => {
    const { handleClientFrame, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never });

    handleClientFrame(entry, s.ws as never, frame({ type: "view", active: true }), SESSION);
    expect(entry.active).toBe(true);
    expect(calls).toEqual([`setWaiting:${SESSION}:false`]);

    handleClientFrame(entry, s.ws as never, frame({ type: "view", active: false }), SESSION);
    expect(entry.active).toBe(false);
    expect(calls).toHaveLength(1); // deactivating must not clear the attention flag
  });

  // The size check used to hang off resize frames alone, so a window that drifted — or one that
  // never got the frame that would have corrected it — had nothing to notice (#1178). Becoming the
  // viewed pane is the moment it matters, so it re-verifies there.
  it("re-verifies a tmux pane's size when it becomes the viewed one", () => {
    const { handleClientFrame, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never, tmux: true });
    handleClientFrame(entry, s.ws as never, frame({ type: "view", active: true }), SESSION);
    expect(calls).toEqual([`setWaiting:${SESSION}:false`, `sizeRecheck:${SESSION}`]);
  });

  it("does not re-verify a size for a pane leaving view, or one with no tmux window", () => {
    const { handleClientFrame, calls } = setup();
    const s = fakeSocket();
    handleClientFrame(entryWith({ ws: s.ws as never, tmux: true }), s.ws as never, frame({ type: "view", active: false }), SESSION);
    handleClientFrame(entryWith({ ws: s.ws as never }), s.ws as never, frame({ type: "view", active: true }), SESSION);
    expect(calls.filter((c) => c.startsWith("sizeRecheck:"))).toEqual([]);
  });

  it("ignores a view frame whose active flag is not a boolean", () => {
    const { handleClientFrame, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never, active: true });
    handleClientFrame(entry, s.ws as never, frame({ type: "view", active: "yes" }), SESSION);
    expect(entry.active).toBe(true);
    expect(calls).toEqual([]);
  });

  it("ignores frames from a socket a newer client has superseded", () => {
    // Two tabs on one session: the older socket must not drive the pty the newer one owns.
    const { handleClientFrame, calls } = setup();
    const t = fakeTerm();
    const current = fakeSocket();
    const stale = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: current.ws as never });
    handleClientFrame(entry, stale.ws as never, frame({ type: "input", data: "rm -rf /" }), SESSION);
    handleClientFrame(entry, stale.ws as never, frame({ type: "view", active: true }), SESSION);
    expect(t.writes).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("never writes a non-JSON payload to the pty, and drops it silently", () => {
    // Silently matters: a client can send anything, so a malformed frame must not
    // reach the pty AND must not let that client flood the server log.
    const { handleClientFrame } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const entry = entryWith({ term: t.term as never, ws: s.ws as never });
      handleClientFrame(entry, s.ws as never, "not json at all", SESSION);
      expect(t.writes).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("ignores an unknown frame type and a non-string input payload", () => {
    const { handleClientFrame } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "whatever" }), SESSION);
    handleClientFrame(entry, s.ws as never, frame({ type: "input", data: { evil: true } }), SESSION);
    expect(t.writes).toEqual([]);
  });

  it("survives a pty that throws mid-write instead of crashing the server", () => {
    // A write racing the pty's exit throws; dropping the frame is the whole point.
    const { handleClientFrame } = setup();
    const s = fakeSocket();
    const entry = entryWith({
      ws: s.ws as never,
      term: {
        write: () => {
          throw new Error("EIO");
        },
      } as never,
    });
    expect(() => handleClientFrame(entry, s.ws as never, frame({ type: "input", data: "x" }), SESSION)).not.toThrow();
  });
});

// The Run menu's terminal has no session identity, so it accepts only input/resize —
// never Delete, which would reach for session machinery that isn't there.
describe("handleCommandFrame", () => {
  const frame = (o: unknown) => JSON.stringify(o);

  it("writes input and applies a valid resize", () => {
    const t = fakeTerm();
    handleCommandFrame(t.term as never, frame({ type: "input", data: "echo hi\r" }));
    handleCommandFrame(t.term as never, frame({ type: "resize", cols: 80, rows: 24 }));
    expect(t.writes).toEqual(["echo hi\r"]);
    expect(t.resizes).toEqual([[80, 24]]);
  });

  it("ignores view — this terminal has no session to act on", () => {
    const t = fakeTerm();
    handleCommandFrame(t.term as never, frame({ type: "view", active: true }));
    handleCommandFrame(t.term as never, frame({ type: "view", active: true }));
    expect(t.writes).toEqual([]);
    expect(t.resizes).toEqual([]);
  });

  it("drops malformed JSON silently, and ignores out-of-bounds resizes", () => {
    const t = fakeTerm();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      handleCommandFrame(t.term as never, "{{{");
      expect(warn).not.toHaveBeenCalled();
      handleCommandFrame(t.term as never, frame({ type: "resize", cols: 9999, rows: 24 }));
      expect(t.writes).toEqual([]);
      expect(t.resizes).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("survives a pty that throws", () => {
    const term = {
      write: () => {
        throw new Error("EIO");
      },
    };
    expect(() => handleCommandFrame(term as never, frame({ type: "input", data: "x" }))).not.toThrow();
  });
});

describe("reattachPty", () => {
  it("swaps in the new socket without a lifetime timer", () => {
    const { reattachPty, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: null });
    reattachPty(entry, s.ws as never, SESSION);
    expect(calls).toEqual([]);
    expect(entry.ws).toBe(s.ws);
  });

  it("replays the buffered tail so the reattached view has context", () => {
    const { reattachPty } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: null, buffer: "previous output" });
    reattachPty(entry, s.ws as never, SESSION);
    expect(s.parsed()).toEqual([{ type: "output", data: "previous output" }]);
  });

  it("strips terminal queries from the replay so xterm does not answer them as input", () => {
    const { reattachPty } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: null, buffer: "before\x1b[c after" });
    reattachPty(entry, s.ws as never, SESSION);
    expect(s.parsed()[0].data).not.toContain("\x1b[c");
  });

  it("sends nothing when there is no buffered output and no modes to restore", () => {
    const { reattachPty } = setup();
    const s = fakeSocket();
    reattachPty(entryWith({ ws: null, buffer: "" }), s.ws as never, SESSION);
    expect(s.sent).toEqual([]);
  });

  // #1073: `CSI ? 1049 h` is written once at pty offset 0 and has long fallen off the bounded
  // tail, so without this the browser restores into the NORMAL buffer and the wheel and click
  // synthesis (#737/#845) stay switched off for the rest of the session.
  it("re-establishes the pane's modes before replaying the tail", () => {
    const { reattachPty } = setup([1049, 1003, 1006]);
    const s = fakeSocket();
    const entry = entryWith({ ws: null, buffer: "previous output", tmux: true });
    reattachPty(entry, s.ws as never, SESSION);
    expect(s.parsed()).toEqual([{ type: "output", data: `\x1b[?1049h\x1b[?1003h\x1b[?1006h${"previous output"}` }]);
  });

  it("restores the modes even when the tail is empty", () => {
    // A session reattached right after a reset has nothing to replay and still owns the alt buffer.
    const { reattachPty } = setup([1049]);
    const s = fakeSocket();
    reattachPty(entryWith({ ws: null, buffer: "", tmux: true }), s.ws as never, SESSION);
    expect(s.parsed()).toEqual([{ type: "output", data: "\x1b[?1049h" }]);
  });

  it("asks nothing of tmux for a session that isn't tmux-backed", () => {
    const { reattachPty, calls } = setup([1049]);
    const s = fakeSocket();
    reattachPty(entryWith({ ws: null, buffer: "sandboxed output" }), s.ws as never, SESSION);
    expect(calls).toEqual([]);
    expect(s.parsed()).toEqual([{ type: "output", data: "sandboxed output" }]);
  });

  it("leaves a pane with nothing sticky set replaying exactly as before", () => {
    // A plain shell reports every flag off — restoring `?1049h` there would strand it in an
    // alternate buffer it never asked for, losing its scrollback.
    const { reattachPty } = setup([]);
    const s = fakeSocket();
    reattachPty(entryWith({ ws: null, buffer: "$ ls\n", tmux: true }), s.ws as never, SESSION);
    expect(s.parsed()).toEqual([{ type: "output", data: "$ ls\n" }]);
  });

  // The replay reconstructs only what changed inside its window, and the alternate buffer it now
  // lands in does not reflow — so the real screen has to be asked for rather than inferred.
  it("marks a tmux session for a redraw, and leaves a non-tmux one alone", () => {
    const { reattachPty } = setup();
    const s = fakeSocket();
    const persistent = entryWith({ ws: null, buffer: "x", tmux: true });
    const sandboxed = entryWith({ ws: null, buffer: "x" });
    reattachPty(persistent, s.ws as never, SESSION);
    reattachPty(sandboxed, s.ws as never, SESSION);
    expect(persistent.redrawPending).toBe(true);
    expect(sandboxed.redrawPending).toBeUndefined();
  });

  it("does not query a socket that is already gone", () => {
    const { reattachPty, calls } = setup([1049]);
    const s = fakeSocket(CLOSED);
    reattachPty(entryWith({ ws: null, buffer: "x", tmux: true }), s.ws as never, SESSION);
    expect(calls).toEqual([]);
    expect(s.sent).toEqual([]);
  });

  it("tells a superseded socket it lost the session before closing it", () => {
    // Without the notice the kicked client auto-reconnects and the two tabs
    // ping-pong, each reattach kicking the other.
    const { reattachPty } = setup();
    const old = fakeSocket();
    const fresh = fakeSocket();
    const entry = entryWith({ ws: old.ws as never, buffer: "" });
    reattachPty(entry, fresh.ws as never, SESSION);
    expect(old.parsed()).toEqual([{ type: "superseded" }]);
    expect(old.closeCount()).toBe(1);
    expect(entry.ws).toBe(fresh.ws);
  });

  it("does not supersede the same socket reattaching to itself", () => {
    const { reattachPty } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never, buffer: "" });
    reattachPty(entry, s.ws as never, SESSION);
    expect(s.parsed()).toEqual([]);
    expect(s.closeCount()).toBe(0);
  });

  it("leaves an already-closed previous socket alone", () => {
    const { reattachPty } = setup();
    const old = fakeSocket(CLOSED);
    const fresh = fakeSocket();
    reattachPty(entryWith({ ws: old.ws as never, buffer: "" }), fresh.ws as never, SESSION);
    expect(old.sent).toEqual([]);
    expect(old.closeCount()).toBe(0);
  });
});

describe("handleClientClose", () => {
  it("kills only an unregistered secondary viewer client", () => {
    const { handleClientClose, currentEntries, calls } = setup();
    const primary = entryWith({ ws: fakeSocket().ws as never });
    currentEntries.set(SESSION, primary);
    const s = fakeSocket();
    const secondary = entryWith({ ws: s.ws as never, active: true });
    registerSecondaryViewer(SESSION, secondary);
    expect(isViewerActive(SESSION, primary)).toBe(true);
    handleClientClose(secondary, s.ws as never, SESSION);
    expect(secondary.term.kill).toHaveBeenCalled();
    expect(isViewerActive(SESSION, primary)).toBe(false);
    expect(primary.ws).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it("detaches the socket and releases the viewer immediately", () => {
    const { handleClientClose, currentEntries, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never, active: true });
    currentEntries.set(SESSION, entry);
    handleClientClose(entry, s.ws as never, SESSION);
    expect(entry.ws).toBeNull();
    expect(calls).toEqual([`sizeCheckCancel:${SESSION}`, `releaseViewer:${SESSION}`]);
  });

  it("drops a settling size check, which has nobody left to repair the screen for", () => {
    const { handleClientClose, currentEntries, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never, tmux: true });
    currentEntries.set(SESSION, entry);
    handleClientClose(entry, s.ws as never, SESSION);
    expect(calls).toContain(`sizeCheckCancel:${SESSION}`);
  });

  it("clears active, so an unclean disconnect cannot suppress the attention flag", () => {
    // A crashed tab never sends `view active:false`; without this the session would
    // stay "being viewed" until someone reconnects.
    const { handleClientClose, currentEntries } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never, active: true });
    currentEntries.set(SESSION, entry);
    handleClientClose(entry, s.ws as never, SESSION);
    expect(entry.active).toBe(false);
  });

  it("ignores the close of a socket a newer client already replaced", () => {
    const { handleClientClose, calls } = setup();
    const current = fakeSocket();
    const stale = fakeSocket();
    const entry = entryWith({ ws: current.ws as never, active: true });
    handleClientClose(entry, stale.ws as never, SESSION);
    expect(entry.ws).toBe(current.ws); // the live socket must survive the old one's close
    expect(entry.active).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("viewer release", () => {
  afterEach(() => {
    viewerPtys.clear();
    activity.clear();
    unregisterCompletionHook(SESSION);
  });

  it("removes only viewer transport and leaves activity/Core-owned state untouched", () => {
    const entry = entryWith({ tmux: true });
    viewerPtys.set(SESSION, entry);
    activity.set(SESSION, { working: true, waiting: false, event: "UserPromptSubmit", at: 1 });
    const forgetTerminalSize = vi.fn();

    expect(releaseViewer({ forgetTerminalSize }, SESSION)).toBe(true);

    expect(viewerPtys.has(SESSION)).toBe(false);
    expect(activity.has(SESSION)).toBe(true);
    expect(entry.term.kill).toHaveBeenCalledOnce();
    expect(forgetTerminalSize).toHaveBeenCalledWith(SESSION);
  });

  it("releases every viewer during shutdown without inventing session cleanup", () => {
    const other = "22222222-3333-4444-8555-666666666666";
    viewerPtys.set(SESSION, entryWith({ tmux: true }));
    viewerPtys.set(other, entryWith({ tmux: true }));

    expect(releaseAllViewers({ forgetTerminalSize: vi.fn() })).toEqual([SESSION, other]);
    expect(viewerPtys.size).toBe(0);
  });

  it("does not report a worker failure when only its viewer is released", async () => {
    const outcomes: boolean[] = [];
    registerCompletionHook(SESSION, ({ didError }) => void outcomes.push(didError));
    viewerPtys.set(SESSION, entryWith({ tmux: true }));

    releaseViewer({ forgetTerminalSize: vi.fn() }, SESSION);
    await runCompletionHook(SESSION, { didError: false });

    expect(outcomes).toEqual([false]);
  });

  it("does not let an old PTY exit release a replacement viewer with the same id", () => {
    const old = entryWith({ tmux: true });
    const replacement = entryWith({ tmux: true });
    viewerPtys.set(SESSION, replacement);
    const forgetTerminalSize = vi.fn();

    expect(releaseViewer({ forgetTerminalSize }, SESSION, old)).toBe(false);

    expect(viewerPtys.get(SESSION)).toBe(replacement);
    expect(replacement.term.kill).not.toHaveBeenCalled();
    expect(forgetTerminalSize).not.toHaveBeenCalled();
  });
});
