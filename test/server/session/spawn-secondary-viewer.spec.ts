// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const secondaryMock = vi.hoisted(() => {
  const state: { exitListener: ((event: { exitCode: number; signal?: number; core?: boolean }) => void) | undefined } = { exitListener: undefined };
  const disposeExit = vi.fn();
  const term = {
    pid: 42,
    onData: vi.fn(),
    onExit: vi.fn((listener: typeof state.exitListener) => {
      state.exitListener = listener;
      return { dispose: disposeExit };
    }),
    kill: vi.fn(),
  };
  return { state, disposeExit, term };
});

vi.mock("../../../server/session/pty-spawn.js", () => ({
  spawnTmuxViewerPty: vi.fn(() => secondaryMock.term),
  isCoreSessionExitEvent: (event: { core?: boolean }) => event.core === true,
}));

import { spawnSecondaryViewer } from "../../../server/session/spawn-secondary-viewer.js";
import { isViewerActive, viewerPtys } from "../../../server/session/viewer-state.js";
import { spawnTmuxViewerPty } from "../../../server/session/pty-spawn.js";
import type { PtyEntry } from "../../../server/session/types.js";

const SESSION = "11111111-2222-3333-4444-555555555555";

function socket() {
  const sent: string[] = [];
  const close = vi.fn();
  return {
    sent,
    close,
    ws: { readyState: 1, OPEN: 1, send: (data: string) => sent.push(data), close },
  };
}

beforeEach(() => {
  secondaryMock.state.exitListener = undefined;
  secondaryMock.disposeExit.mockClear();
  secondaryMock.term.onExit.mockClear();
  viewerPtys.clear();
});

describe("spawnSecondaryViewer", () => {
  it("spawns at the primary viewer's geometry", () => {
    viewerPtys.set(SESSION, { term: { cols: 132, rows: 43 } } as unknown as PtyEntry);

    spawnSecondaryViewer(SESSION, socket().ws as never, "/repo", "shell");

    expect(spawnTmuxViewerPty).toHaveBeenCalledWith(SESSION, "/repo", { cols: 132, rows: 43 });
  });

  it("sends Core exit and removes secondary activity state", () => {
    const s = socket();
    const entry = spawnSecondaryViewer(SESSION, s.ws as never, "/repo", "shell");
    entry.active = true;
    expect(isViewerActive(SESSION, undefined)).toBe(true);

    secondaryMock.state.exitListener?.({ exitCode: 9, signal: 0, core: true });

    expect(s.sent.map((frame) => JSON.parse(frame))).toContainEqual({ type: "exit", exitCode: 9, signal: 0 });
    expect(s.close).toHaveBeenCalledOnce();
    expect(secondaryMock.disposeExit).toHaveBeenCalledOnce();
    expect(isViewerActive(SESSION, undefined)).toBe(false);
  });

  it("closes a native tmux-client exit without reporting session exit", () => {
    const s = socket();
    spawnSecondaryViewer(SESSION, s.ws as never, "/repo", "shell");

    secondaryMock.state.exitListener?.({ exitCode: 0, signal: 15 });

    expect(s.sent).toEqual([]);
    expect(s.close).toHaveBeenCalledOnce();
    expect(isViewerActive(SESSION, undefined)).toBe(false);
  });
});
