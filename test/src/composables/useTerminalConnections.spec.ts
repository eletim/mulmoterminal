import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The xterm / addon / WebSocket doubles are shared (test/helpers/xtermDouble.ts). The shape below
// is dictated by hoisting: `vi.mock` factories run BEFORE this file's imports, so they cannot
// close over one — hence `await import` inside each factory, and `vi.hoisted` for the state they
// write into (a plain `const` would be in its temporal dead zone when a factory runs).
const { termState: mockTermState, keyState: mockKeyState } = await vi.hoisted(async () => (await import("../../helpers/xtermDouble")).createXtermState());

vi.mock("@xterm/xterm", async () => (await import("../../helpers/xtermDouble")).xtermModule(mockTermState, mockKeyState));
vi.mock("@xterm/addon-fit", async () => (await import("../../helpers/xtermDouble")).fitAddonModule());
vi.mock("@xterm/addon-web-links", async () => (await import("../../helpers/xtermDouble")).webLinksAddonModule());
vi.mock("@xterm/addon-clipboard", async () => (await import("../../helpers/xtermDouble")).clipboardAddonModule());
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import * as conn from "../../../src/composables/useTerminalConnections";
import { FakeWebSocket } from "../../helpers/xtermDouble";
import { newlineSequence, submitSequence } from "../../../common/terminalSubmit";
import { setTerminalSubmitMode } from "../../../src/composables/terminalSubmitMode";
import { clickReportSequences } from "../../../src/composables/mouseReports";

const target = (sessionId: string | null) => ({ sessionId, cwd: "/typed", devTerminal: false, command: null, launcher: null });
const lastFrameOf = (ws: FakeWebSocket, type: string): Record<string, unknown> | undefined =>
  [...ws.sent]
    .reverse()
    .map((frame) => JSON.parse(frame) as Record<string, unknown>)
    .find((frame) => frame.type === type);
const viewportFrame = (requestId: number, cursor: string, live: boolean, rows = 24, historyRows = 100) => ({
  type: "viewport",
  requestId,
  viewport: {
    content: Array.from({ length: rows }, (_, index) => `${cursor}-${index}`).join("\n") + "\n",
    cursor,
    live,
    cols: 80,
    screenRows: rows,
    viewportRows: rows,
    historyRows,
    historyLimit: 20_000,
    clamped: false,
    rebased: false,
  },
});

describe("useTerminalConnections — detached-slot state replay", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    mockTermState.bufferLines = [];
    mockTermState.bufferLength = 24;
    mockTermState.resizes.length = 0;
  });
  afterEach(() => {
    conn.release("cell-race"); // tear the slot down so it can't leak into the next test
  });

  it("replays a session id learned WHILE DETACHED to the handlers bound on reattach", () => {
    const first = { onSession: vi.fn(), onCwd: vi.fn() };
    const el1 = document.createElement("div");
    conn.attach("cell-race", target(null), first, el1); // fresh launch, no id yet
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    // User navigates away BEFORE the server reports the session id.
    conn.detach("cell-race", el1);
    expect(conn.connView.get("cell-race")).toBeTruthy(); // socket/slot still alive

    // Server NOW assigns the id + resolves the cwd — handlers are detached, so the
    // first view's callbacks must NOT fire (it's gone).
    ws.onmessage?.({ data: JSON.stringify({ type: "session", id: "sess-123", cwd: "/resolved" }) });
    expect(first.onSession).not.toHaveBeenCalled();

    // Coming back must catch the parent up: the freshly-bound handlers receive the
    // id/cwd that arrived while detached — without this the cell stays session:null
    // and is unrestorable on reload.
    const second = { onSession: vi.fn(), onCwd: vi.fn() };
    const el2 = document.createElement("div");
    conn.attach("cell-race", target(null), second, el2);
    expect(second.onSession).toHaveBeenCalledWith("sess-123");
    expect(second.onCwd).toHaveBeenCalledWith("/resolved");
  });

  it("delivers an initial session-state once, does not call a detached viewer, and refreshes on reattach", () => {
    const onSessionState = vi.fn();
    const host = document.createElement("div");
    conn.attach("cell-race", target("sess-123"), { onSessionState }, host);
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    const state = { id: "sess-123", working: true, waiting: false };
    ws.onmessage?.({ data: JSON.stringify({ type: "session-state", state }) });
    expect(onSessionState).toHaveBeenCalledTimes(1);
    expect(onSessionState).toHaveBeenCalledWith(state);

    conn.detach("cell-race", host);
    ws.onmessage?.({ data: JSON.stringify({ type: "session-state", state: { ...state, waiting: true } }) });
    expect(onSessionState).toHaveBeenCalledTimes(1);

    const reattached = vi.fn();
    conn.attach("cell-race", target("sess-123"), { onSessionState: reattached }, document.createElement("div"));
    expect(reattached).toHaveBeenCalledOnce();
    expect(lastFrameOf(ws, "session-state")).toEqual({ type: "session-state", requestId: 1 });
  });

  it("can request one current snapshot when the independent pub/sub transport reconnects", () => {
    conn.attach("cell-state-resync", target("sess-123"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.readyState = FakeWebSocket.CONNECTING;
    expect(conn.requestSessionState("cell-state-resync")).toBe(false);
    ws.readyState = FakeWebSocket.OPEN;
    ws.onopen?.();
    expect(conn.requestSessionState("cell-state-resync")).toBe(true);
    expect(lastFrameOf(ws, "session-state")).toEqual({ type: "session-state", requestId: 1 });
    conn.release("cell-state-resync");
  });

  it("ignores an older session-state snapshot that finishes after a newer request", () => {
    const onSessionState = vi.fn();
    conn.attach("cell-state-order", target("sess-123"), { onSessionState }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();
    expect(conn.requestSessionState("cell-state-order")).toBe(true);
    expect(conn.requestSessionState("cell-state-order")).toBe(true);

    const newer = { id: "sess-123", working: false };
    const older = { id: "sess-123", working: true };
    ws.onmessage?.({ data: JSON.stringify({ type: "session-state", requestId: 2, state: newer }) });
    ws.onmessage?.({ data: JSON.stringify({ type: "session-state", requestId: 1, state: older }) });

    expect(onSessionState).toHaveBeenCalledOnce();
    expect(onSessionState).toHaveBeenCalledWith(newer);
    conn.release("cell-state-order");
  });

  it("keeps session-state delivery independent for multiple viewers of one Core session", () => {
    const onA = vi.fn();
    const onB = vi.fn();
    conn.attach("viewer-a", target("shared-session"), { onSessionState: onA }, document.createElement("div"));
    const wsA = FakeWebSocket.instances.at(-1);
    conn.attach("viewer-b", target("shared-session"), { onSessionState: onB }, document.createElement("div"));
    const wsB = FakeWebSocket.instances.at(-1);
    if (!wsA || !wsB) throw new Error("viewer socket missing");

    const state = { id: "shared-session", working: false, waiting: true };
    wsA.onmessage?.({ data: JSON.stringify({ type: "session-state", state }) });
    wsB.onmessage?.({ data: JSON.stringify({ type: "session-state", state }) });
    expect(onA).toHaveBeenCalledWith(state);
    expect(onB).toHaveBeenCalledWith(state);
    conn.release("viewer-a");
    conn.release("viewer-b");
  });

  it("keeps opaque viewport cursors independent for two browser viewers", () => {
    conn.attach("viewer-a", target("shared-session"), {}, document.createElement("div"));
    const wsA = FakeWebSocket.instances.at(-1);
    if (!wsA) throw new Error("viewer A socket missing");
    wsA.onopen?.();
    const wheelA = mockTermState.wheelHandler;

    conn.attach("viewer-b", target("shared-session"), {}, document.createElement("div"));
    const wsB = FakeWebSocket.instances.at(-1);
    if (!wsB) throw new Error("viewer B socket missing");
    wsB.onopen?.();
    const wheelB = mockTermState.wheelHandler;

    const viewport = (cursor: string, requestId: number) => ({
      type: "viewport",
      requestId,
      viewport: {
        content: cursor,
        cursor,
        live: false,
        cols: 80,
        screenRows: 24,
        viewportRows: 24,
        historyRows: 100,
        historyLimit: 20000,
        clamped: false,
        rebased: false,
      },
    });
    const requestIdA = Number(lastFrameOf(wsA, "viewport")?.requestId);
    const requestIdB = Number(lastFrameOf(wsB, "viewport")?.requestId);
    wsA.onmessage?.({ data: JSON.stringify(viewport("cursor-a", requestIdA)) });
    wsB.onmessage?.({ data: JSON.stringify(viewport("cursor-b", requestIdB)) });
    wheelA({ deltaY: -120, preventDefault: vi.fn() });
    wheelB({ deltaY: -120, preventDefault: vi.fn() });

    expect(lastFrameOf(wsA, "scroll")?.cursor).toBe("cursor-a");
    expect(lastFrameOf(wsB, "scroll")?.cursor).toBe("cursor-b");
    conn.release("viewer-a");
    conn.release("viewer-b");
  });

  it("prefetches two visible-row chunks and keeps small wheel movement off the socket", () => {
    const key = "viewer-client-cache";
    conn.attach(key, target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const response = (requestId: number, first: number, cursor: string, live: boolean) =>
      ws.onmessage?.({
        data: JSON.stringify({
          type: "viewport",
          requestId,
          viewport: {
            content: Array.from({ length: 24 }, (_, index) => String(first + index)).join("\n") + "\n",
            cursor,
            live,
            cols: 80,
            screenRows: 24,
            viewportRows: 24,
            historyRows: 100,
            historyLimit: 20_000,
            clamped: false,
            rebased: false,
          },
        }),
      });

    response(Number(lastFrameOf(ws, "viewport")?.requestId), 61, "live-boundary", true);
    const firstPrefetch = lastFrameOf(ws, "viewport");
    expect(firstPrefetch).toMatchObject({ rows: 24, fraction: 0.76 });
    response(Number(firstPrefetch?.requestId), 37, "older-1", false);
    const secondPrefetch = lastFrameOf(ws, "viewport");
    expect(secondPrefetch).toMatchObject({ rows: 24, fraction: 0.52 });
    response(Number(secondPrefetch?.requestId), 13, "older-2", false);

    // The first live-boundary gesture still asks Core to classify ownership: only Core can know
    // whether a TUI owns wheel input. A viewport result authorizes local history navigation.
    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    const ownershipCheck = lastFrameOf(ws, "scroll");
    ws.onmessage?.({
      data: JSON.stringify({
        type: "scroll-result",
        requestId: ownershipCheck?.requestId,
        result: {
          kind: "viewport",
          viewport: {
            content: Array.from({ length: 24 }, (_, index) => String(60 + index)).join("\n") + "\n",
            cursor: "confirmed-history",
            live: false,
            cols: 80,
            screenRows: 24,
            viewportRows: 24,
            historyRows: 100,
            historyLimit: 20_000,
            clamped: false,
            rebased: false,
          },
        },
      }),
    });
    const scrollCount = ws.sent.filter((frame) => JSON.parse(frame).type === "scroll").length;
    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    expect(ws.sent.filter((frame) => JSON.parse(frame).type === "scroll")).toHaveLength(scrollCount);

    // The headless xterm has no cell metrics, so each event is one row; crossing the one-chunk
    // threshold starts an older prefetch.
    for (let index = 0; index < 22; index++) mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    const boundaryPrefetch = lastFrameOf(ws, "scroll");
    expect(boundaryPrefetch).toMatchObject({ direction: "up", lines: 24, rows: 24, cursor: "older-2" });
    ws.onmessage?.({
      data: JSON.stringify({
        type: "scroll-result",
        requestId: boundaryPrefetch?.requestId,
        result: {
          kind: "viewport",
          viewport: {
            content: Array.from({ length: 24 }, (_, index) => String(index - 11)).join("\n") + "\n",
            cursor: "older-3",
            live: false,
            cols: 80,
            screenRows: 24,
            viewportRows: 24,
            historyRows: 100,
            historyLimit: 20_000,
            clamped: false,
            rebased: false,
          },
        },
      }),
    });
    const afterPrepend = ws.sent.filter((frame) => JSON.parse(frame).type === "scroll").length;
    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    expect(ws.sent.filter((frame) => JSON.parse(frame).type === "scroll")).toHaveLength(afterPrepend);
    conn.release(key);
  });

  it.each(["clamped", "rebased"] as const)("does not combine a %s Core viewport with stale cached rows", (flag) => {
    const key = `viewer-cache-${flag}`;
    conn.attach(key, target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const requestId = Number(lastFrameOf(ws, "viewport")?.requestId);
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId,
        viewport: {
          content: "authoritative",
          cursor: `${flag}-cursor`,
          live: false,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: flag === "clamped",
          rebased: flag === "rebased",
        },
      }),
    });

    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    expect(lastFrameOf(ws, "scroll")?.cursor).toBe(`${flag}-cursor`);
    conn.release(key);
  });

  it("uses a cached chunk cursor plus its local offset after historical output dirties the cache", () => {
    const key = "viewer-dirty-cache-anchor";
    conn.attach(key, target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify(viewportFrame(Number(lastFrameOf(ws, "viewport")?.requestId), "live", true)) });
    const older1 = lastFrameOf(ws, "viewport");
    ws.onmessage?.({ data: JSON.stringify(viewportFrame(Number(older1?.requestId), "older-1", false)) });
    const older2 = lastFrameOf(ws, "viewport");
    ws.onmessage?.({ data: JSON.stringify(viewportFrame(Number(older2?.requestId), "older-2", false)) });

    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    const ownership = lastFrameOf(ws, "scroll");
    ws.onmessage?.({
      data: JSON.stringify({
        type: "scroll-result",
        requestId: ownership?.requestId,
        result: { kind: "viewport", viewport: viewportFrame(0, "confirmed", false).viewport },
      }),
    });
    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "new output while historical" }) });
    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });

    expect(lastFrameOf(ws, "scroll")).toMatchObject({ cursor: "older-1", direction: "down", lines: 21 });
    conn.release(key);
  });

  it("discards an old initial-prefetch response and recaptures with resized rows", () => {
    const key = "viewer-initial-prefetch-resize";
    conn.attach(key, target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify(viewportFrame(Number(lastFrameOf(ws, "viewport")?.requestId), "live", true)) });
    const stalePrefetch = lastFrameOf(ws, "viewport");

    ws.onmessage?.({ data: JSON.stringify({ type: "terminal-geometry", cols: 132, rows: 43 }) });
    ws.onmessage?.({ data: JSON.stringify(viewportFrame(Number(stalePrefetch?.requestId), "stale-prefetch", false)) });

    expect(lastFrameOf(ws, "viewport")).toMatchObject({ rows: 43 });
    expect(lastFrameOf(ws, "viewport")).not.toHaveProperty("fraction");
    conn.release(key);
  });

  it("keeps the displayed cache in place when a speculative prefetch fails", () => {
    const key = "viewer-prefetch-error";
    conn.attach(key, target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify(viewportFrame(Number(lastFrameOf(ws, "viewport")?.requestId), "live", true)) });
    const older1 = lastFrameOf(ws, "viewport");
    ws.onmessage?.({ data: JSON.stringify(viewportFrame(Number(older1?.requestId), "older-1", false)) });
    const older2 = lastFrameOf(ws, "viewport");
    ws.onmessage?.({ data: JSON.stringify(viewportFrame(Number(older2?.requestId), "older-2", false)) });
    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    const ownership = lastFrameOf(ws, "scroll");
    ws.onmessage?.({
      data: JSON.stringify({
        type: "scroll-result",
        requestId: ownership?.requestId,
        result: { kind: "viewport", viewport: viewportFrame(0, "confirmed", false).viewport },
      }),
    });
    for (let index = 0; index < 23; index++) mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    const prefetch = lastFrameOf(ws, "scroll");
    const viewportCount = ws.sent.filter((frame) => JSON.parse(frame).type === "viewport").length;
    const rendered = [...mockTermState.bufferLines];

    ws.onmessage?.({ data: JSON.stringify({ type: "scroll-error", requestId: prefetch?.requestId, message: "unstable" }) });

    expect(ws.sent.filter((frame) => JSON.parse(frame).type === "viewport")).toHaveLength(viewportCount);
    expect(mockTermState.bufferLines).toEqual(rendered);
    conn.release(key);
  });

  it("does not render a clamped speculative prefetch destination", () => {
    const key = "viewer-prefetch-clamped";
    conn.attach(key, target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify(viewportFrame(Number(lastFrameOf(ws, "viewport")?.requestId), "live", true)) });
    for (const cursor of ["older-1", "older-2"]) {
      const request = lastFrameOf(ws, "viewport");
      ws.onmessage?.({ data: JSON.stringify(viewportFrame(Number(request?.requestId), cursor, false)) });
    }
    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    const ownership = lastFrameOf(ws, "scroll");
    ws.onmessage?.({
      data: JSON.stringify({
        type: "scroll-result",
        requestId: ownership?.requestId,
        result: { kind: "viewport", viewport: viewportFrame(0, "confirmed", false).viewport },
      }),
    });
    for (let index = 0; index < 23; index++) mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    const prefetch = lastFrameOf(ws, "scroll");
    const rendered = [...mockTermState.bufferLines];
    const clamped = viewportFrame(0, "clamped-destination", false).viewport;
    clamped.clamped = true;

    ws.onmessage?.({
      data: JSON.stringify({ type: "scroll-result", requestId: prefetch?.requestId, result: { kind: "viewport", viewport: clamped } }),
    });

    expect(mockTermState.bufferLines).toEqual(rendered);
    conn.release(key);
  });

  it("keeps live output active when optional initial prefetch fails", () => {
    const key = "viewer-initial-prefetch-error";
    conn.attach(key, target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify(viewportFrame(Number(lastFrameOf(ws, "viewport")?.requestId), "live", true)) });
    const prefetch = lastFrameOf(ws, "viewport");

    ws.onmessage?.({ data: JSON.stringify({ type: "viewport-error", requestId: prefetch?.requestId, message: "unstable" }) });
    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "still live" }) });

    expect(mockTermState.bufferLines.join("\n")).toContain("still live");
    conn.release(key);
  });

  it("leaves history cache untouched when Core gives wheel ownership to an application", () => {
    const key = "viewer-cache-application";
    conn.attach(key, target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const requestId = Number(lastFrameOf(ws, "viewport")?.requestId);
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId,
        viewport: {
          content: "application screen",
          cursor: "application-live-cursor",
          live: true,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 0,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });
    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    const scroll = lastFrameOf(ws, "scroll");
    const rendered = [...mockTermState.bufferLines];
    ws.onmessage?.({ data: JSON.stringify({ type: "scroll-result", requestId: scroll?.requestId, result: { kind: "application" } }) });

    expect(mockTermState.bufferLines).toEqual(rendered);
    conn.release(key);
  });

  it("applies the shared terminal geometry sent by the server", () => {
    conn.attach("viewer-shared-geometry", target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const requestId = Number(lastFrameOf(ws, "viewport")?.requestId);
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId,
        viewport: {
          content: "historical screen",
          cursor: "historical-cursor",
          live: false,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });

    ws.onmessage?.({ data: JSON.stringify({ type: "terminal-geometry", cols: 132, rows: 43 }) });

    expect(mockTermState.resizes).toContainEqual([132, 43]);
    expect(lastFrameOf(ws, "viewport")).not.toHaveProperty("cursor");
    expect(Number(lastFrameOf(ws, "viewport")?.requestId)).toBeGreaterThan(requestId);
    conn.release("viewer-shared-geometry");
  });

  it("invalidates history cache on a width-only geometry change and rebuilds from live", () => {
    const key = "viewer-width-only-resize";
    conn.attach(key, target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const requestId = Number(lastFrameOf(ws, "viewport")?.requestId);
    ws.onmessage?.({ data: JSON.stringify(viewportFrame(requestId, "historical", false)) });

    ws.onmessage?.({ data: JSON.stringify({ type: "terminal-geometry", cols: 132, rows: 24 }) });

    expect(lastFrameOf(ws, "viewport")).toMatchObject({ rows: 24 });
    expect(lastFrameOf(ws, "viewport")).not.toHaveProperty("cursor");
    expect(Number(lastFrameOf(ws, "viewport")?.requestId)).toBeGreaterThan(requestId);
    conn.release(key);
  });

  it("recaptures instead of rendering a viewport invalidated by shared geometry", () => {
    conn.attach("viewer-geometry-viewport-race", target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const requestId = Number(lastFrameOf(ws, "viewport")?.requestId);

    ws.onmessage?.({ data: JSON.stringify({ type: "terminal-geometry", cols: 132, rows: 43 }) });
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId,
        viewport: {
          content: "stale old-geometry viewport",
          cursor: "stale-live-cursor",
          live: true,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });

    expect(mockTermState.bufferLines.join("\n")).not.toContain("stale old-geometry viewport");
    const refresh = lastFrameOf(ws, "viewport");
    expect(refresh).toMatchObject({ rows: 43 });
    expect(refresh).not.toHaveProperty("cursor");
    expect(Number(refresh?.requestId)).toBeGreaterThan(requestId);
    conn.release("viewer-geometry-viewport-race");
  });

  it("recaptures a scroll anchor instead of rendering old-geometry content", () => {
    conn.attach("viewer-geometry-scroll-race", target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const viewportRequestId = Number(lastFrameOf(ws, "viewport")?.requestId);
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId: viewportRequestId,
        viewport: {
          content: "historical screen",
          cursor: "old-cursor",
          live: false,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });
    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    const scrollRequestId = Number(lastFrameOf(ws, "scroll")?.requestId);

    ws.onmessage?.({ data: JSON.stringify({ type: "terminal-geometry", cols: 132, rows: 43 }) });
    ws.onmessage?.({
      data: JSON.stringify({
        type: "scroll-result",
        requestId: scrollRequestId,
        result: {
          kind: "viewport",
          viewport: {
            content: "stale scrolled content",
            cursor: "new-scroll-cursor",
            live: false,
            cols: 80,
            screenRows: 24,
            viewportRows: 24,
            historyRows: 100,
            historyLimit: 20_000,
            clamped: false,
            rebased: false,
          },
        },
      }),
    });

    expect(mockTermState.bufferLines.join("\n")).not.toContain("stale scrolled content");
    expect(lastFrameOf(ws, "viewport")).toMatchObject({ rows: 43 });
    expect(lastFrameOf(ws, "viewport")).not.toHaveProperty("cursor");
    conn.release("viewer-geometry-scroll-race");
  });

  it("serializes a historical resize refresh after an in-flight scroll", () => {
    const key = "viewer-scroll-resize-race";
    conn.attach(key, target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const viewportRequestId = Number(lastFrameOf(ws, "viewport")?.requestId);
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId: viewportRequestId,
        viewport: {
          content: "old historical screen",
          cursor: "old-cursor",
          live: false,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });

    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    const scrollRequestId = Number(lastFrameOf(ws, "scroll")?.requestId);
    const viewportCountBeforeResize = ws.sent.filter((frame) => JSON.parse(frame).type === "viewport").length;
    conn.setFont(key, { size: 18, family: "monospace" });
    expect(ws.sent.filter((frame) => JSON.parse(frame).type === "viewport")).toHaveLength(viewportCountBeforeResize);

    ws.onmessage?.({
      data: JSON.stringify({
        type: "scroll-result",
        requestId: scrollRequestId,
        result: {
          kind: "viewport",
          viewport: {
            content: "new historical screen",
            cursor: "new-cursor",
            live: false,
            cols: 80,
            screenRows: 24,
            viewportRows: 24,
            historyRows: 100,
            historyLimit: 20_000,
            clamped: false,
            rebased: false,
          },
        },
      }),
    });

    const refresh = lastFrameOf(ws, "viewport");
    expect(refresh?.cursor).toBe("new-cursor");
    expect(Number(refresh?.requestId)).toBeGreaterThan(viewportRequestId);
    conn.release(key);
  });

  it("drops a live snapshot cursor when new PTY output arrives before the next wheel", () => {
    conn.attach("viewer-live-output", target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const requestId = Number(lastFrameOf(ws, "viewport")?.requestId);
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId,
        viewport: {
          content: "live",
          cursor: "live-snapshot-cursor",
          live: true,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });

    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "new output" }) });
    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });

    expect(lastFrameOf(ws, "scroll")).not.toHaveProperty("cursor");
    conn.release("viewer-live-output");
  });

  it("recaptures live when PTY output races an initial viewport response", () => {
    conn.attach("viewer-capture-race", target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const firstRequestId = Number(lastFrameOf(ws, "viewport")?.requestId);

    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "newer output" }) });
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId: firstRequestId,
        viewport: {
          content: "older capture",
          cursor: "older-cursor",
          live: true,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });

    const retry = lastFrameOf(ws, "viewport");
    expect(Number(retry?.requestId)).toBeGreaterThan(firstRequestId);
    expect(retry).not.toHaveProperty("cursor");
    conn.release("viewer-capture-race");
  });

  it("recaptures when output races a historical scroll that reaches live", () => {
    conn.attach("viewer-scroll-live-race", target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const viewportRequestId = Number(lastFrameOf(ws, "viewport")?.requestId);
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId: viewportRequestId,
        viewport: {
          content: "historical screen",
          cursor: "historical-cursor",
          live: false,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });

    mockTermState.wheelHandler({ deltaY: 120, preventDefault: vi.fn() });
    const scrollRequestId = Number(lastFrameOf(ws, "scroll")?.requestId);
    const historicalScreen = mockTermState.bufferLines.join("\n");
    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "new output after capture" }) });
    ws.onmessage?.({
      data: JSON.stringify({
        type: "scroll-result",
        requestId: scrollRequestId,
        result: {
          kind: "viewport",
          viewport: {
            content: "stale live screen",
            cursor: "stale-live-cursor",
            live: true,
            cols: 80,
            screenRows: 24,
            viewportRows: 24,
            historyRows: 100,
            historyLimit: 20_000,
            clamped: false,
            rebased: false,
          },
        },
      }),
    });

    expect(mockTermState.bufferLines.join("\n")).toBe(historicalScreen);
    const retry = lastFrameOf(ws, "viewport");
    expect(Number(retry?.requestId)).toBeGreaterThan(viewportRequestId);
    expect(retry).not.toHaveProperty("cursor");
    conn.release("viewer-scroll-live-race");
  });

  it("recaptures when output races a live scroll result", () => {
    conn.attach("viewer-live-scroll-race", target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const viewportRequestId = Number(lastFrameOf(ws, "viewport")?.requestId);
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId: viewportRequestId,
        viewport: {
          content: "live screen",
          cursor: "live-cursor",
          live: true,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });

    mockTermState.wheelHandler({ deltaY: 120, preventDefault: vi.fn() });
    const scrollRequestId = Number(lastFrameOf(ws, "scroll")?.requestId);
    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "new output after capture" }) });
    ws.onmessage?.({
      data: JSON.stringify({
        type: "scroll-result",
        requestId: scrollRequestId,
        result: {
          kind: "viewport",
          viewport: {
            content: "stale live screen",
            cursor: "stale-live-cursor",
            live: true,
            cols: 80,
            screenRows: 24,
            viewportRows: 24,
            historyRows: 100,
            historyLimit: 20_000,
            clamped: false,
            rebased: false,
          },
        },
      }),
    });

    const retry = lastFrameOf(ws, "viewport");
    expect(Number(retry?.requestId)).toBeGreaterThan(viewportRequestId);
    expect(retry).not.toHaveProperty("cursor");
    expect(mockTermState.bufferLines.join("\n")).not.toContain("stale live screen");
    conn.release("viewer-live-scroll-race");
  });

  it("retries a failed return-to-live viewport while suppressing PTY deltas", () => {
    vi.useFakeTimers();
    try {
      conn.attach("viewer-live-error", target("shared-session"), {}, document.createElement("div"));
      const ws = FakeWebSocket.instances.at(-1);
      if (!ws) throw new Error("viewer socket missing");
      ws.onopen?.();
      const viewportRequestId = Number(lastFrameOf(ws, "viewport")?.requestId);
      ws.onmessage?.({
        data: JSON.stringify({
          type: "viewport",
          requestId: viewportRequestId,
          viewport: {
            content: "historical screen",
            cursor: "historical-cursor",
            live: false,
            cols: 80,
            screenRows: 24,
            viewportRows: 24,
            historyRows: 100,
            historyLimit: 20_000,
            clamped: false,
            rebased: false,
          },
        }),
      });

      mockTermState.emitData("x");
      const failedRequestId = Number(lastFrameOf(ws, "viewport")?.requestId);
      const historicalScreen = mockTermState.bufferLines.join("\n");
      ws.onmessage?.({ data: JSON.stringify({ type: "viewport-error", requestId: failedRequestId, message: "capture raced" }) });

      expect(lastFrameOf(ws, "viewport")?.requestId).toBe(failedRequestId);
      vi.advanceTimersByTime(100);
      const retry = lastFrameOf(ws, "viewport");
      expect(Number(retry?.requestId)).toBeGreaterThan(failedRequestId);
      expect(retry).not.toHaveProperty("cursor");
      ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "echo after failed capture" }) });
      expect(mockTermState.bufferLines.join("\n")).toBe(historicalScreen);

      const retryRequestId = Number(retry?.requestId);
      ws.onmessage?.({ data: JSON.stringify({ type: "viewport-error", requestId: retryRequestId, message: "still unavailable" }) });
      expect(lastFrameOf(ws, "viewport")?.requestId).toBe(retryRequestId);
      vi.advanceTimersByTime(200);
      expect(Number(lastFrameOf(ws, "viewport")?.requestId)).toBeGreaterThan(retryRequestId);
    } finally {
      conn.release("viewer-live-error");
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("drops the browser-local cursor on reconnect and resumes from live", () => {
    conn.attach("viewer-reconnect", target("shared-session"), {}, document.createElement("div"));
    const first = FakeWebSocket.instances.at(-1);
    if (!first) throw new Error("first socket missing");
    first.onopen?.();
    const requestId = lastFrameOf(first, "viewport")?.requestId;
    first.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId,
        viewport: {
          content: "old",
          cursor: "old-cursor",
          live: false,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20000,
          clamped: false,
          rebased: false,
        },
      }),
    });

    conn.retarget("viewer-reconnect", target("shared-session"));
    const second = FakeWebSocket.instances.at(-1);
    if (!second) throw new Error("second socket missing");
    second.onopen?.();
    const request = second.sent.map((frame) => JSON.parse(frame)).find((frame) => frame.type === "viewport");
    expect(request).toEqual(expect.objectContaining({ type: "viewport", rows: 24 }));
    expect(request).not.toHaveProperty("cursor");
    conn.release("viewer-reconnect");
  });

  it("ignores a historical scroll result that arrives after typed input returned the viewer to live", () => {
    conn.attach("viewer-input-race", target("shared-session"), {}, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("viewer socket missing");
    ws.onopen?.();
    const viewportRequestId = Number(lastFrameOf(ws, "viewport")?.requestId);
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId: viewportRequestId,
        viewport: {
          content: "history",
          cursor: "historical-cursor",
          live: false,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });

    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    const staleRequestId = Number(lastFrameOf(ws, "scroll")?.requestId);
    mockTermState.emitData("x");
    const firstLiveRequest = lastFrameOf(ws, "viewport");
    const firstLiveRequestId = Number(firstLiveRequest?.requestId);
    expect(firstLiveRequest).not.toHaveProperty("cursor");

    const historicalScreen = mockTermState.bufferLines.join("\n");
    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "x" }) });
    expect(mockTermState.bufferLines.join("\n")).toBe(historicalScreen);
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId: firstLiveRequestId,
        viewport: {
          content: "live before echo",
          cursor: "intermediate-live-cursor",
          live: true,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });
    const finalLiveRequest = lastFrameOf(ws, "viewport");
    const finalLiveRequestId = Number(finalLiveRequest?.requestId);
    expect(finalLiveRequestId).toBeGreaterThan(firstLiveRequestId);
    expect(finalLiveRequest).not.toHaveProperty("cursor");
    ws.onmessage?.({
      data: JSON.stringify({
        type: "viewport",
        requestId: finalLiveRequestId,
        viewport: {
          content: "live with echo",
          cursor: "fresh-live-cursor",
          live: true,
          cols: 80,
          screenRows: 24,
          viewportRows: 24,
          historyRows: 100,
          historyLimit: 20_000,
          clamped: false,
          rebased: false,
        },
      }),
    });
    ws.onmessage?.({
      data: JSON.stringify({
        type: "scroll-result",
        requestId: staleRequestId,
        result: {
          kind: "viewport",
          viewport: {
            content: "stale history",
            cursor: "stale-cursor",
            live: false,
            cols: 80,
            screenRows: 24,
            viewportRows: 24,
            historyRows: 100,
            historyLimit: 20_000,
            clamped: false,
            rebased: false,
          },
        },
      }),
    });

    mockTermState.wheelHandler({ deltaY: -120, preventDefault: vi.fn() });
    expect(lastFrameOf(ws, "scroll")?.cursor).toBe("fresh-live-cursor");
    conn.release("viewer-input-race");
  });

  it.each([
    ["submitText", (key: string) => conn.submitText(key, "hello")],
    ["pasteText", (key: string) => conn.pasteText(key, "hello")],
    ["pasteAndSubmit", (key: string) => conn.pasteAndSubmit(key, "hello")],
    ["insertText", (key: string) => conn.insertText(key, "hello")],
  ])("returns a historical viewer to live for programmatic %s input", (_label, send) => {
    vi.useFakeTimers();
    const key = `viewer-programmatic-${_label}`;
    try {
      conn.attach(key, target("shared-session"), {}, document.createElement("div"));
      const ws = FakeWebSocket.instances.at(-1);
      if (!ws) throw new Error("viewer socket missing");
      ws.onopen?.();
      const initialRequestId = Number(lastFrameOf(ws, "viewport")?.requestId);
      ws.onmessage?.({
        data: JSON.stringify({
          type: "viewport",
          requestId: initialRequestId,
          viewport: {
            content: "history",
            cursor: "historical-cursor",
            live: false,
            cols: 80,
            screenRows: 24,
            viewportRows: 24,
            historyRows: 100,
            historyLimit: 20_000,
            clamped: false,
            rebased: false,
          },
        }),
      });

      send(key);

      expect(lastFrameOf(ws, "input")).toBeTruthy();
      const liveRequest = lastFrameOf(ws, "viewport");
      expect(Number(liveRequest?.requestId)).toBeGreaterThan(initialRequestId);
      expect(liveRequest).not.toHaveProperty("cursor");
    } finally {
      conn.release(key);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("wires the Enter handler through ensure() (cr mode): sends \\x1b\\r on Shift+Enter and cancels the default", () => {
    mockKeyState.handler = () => true; // reset (the mock persists across tests)
    setTerminalSubmitMode("cr");
    conn.attach("cell-key", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.(); // open so send() passes the readyState guard

    const preventDefault = vi.fn();
    const shiftEnter = { type: "keydown", key: "Enter", shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, preventDefault };
    expect(mockKeyState.handler(shiftEnter)).toBe(false); // false => xterm won't also emit \r
    expect(ws.sent).toContain(JSON.stringify({ type: "input", data: newlineSequence("cr") }));
    expect(preventDefault).toHaveBeenCalled(); // cancels the default so no follow-up keypress leaks a \r

    // A plain Enter is left to xterm (returns true, sends nothing extra).
    ws.sent.length = 0;
    expect(
      mockKeyState.handler({
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      }),
    ).toBe(true);
    expect(ws.sent).toHaveLength(0);
    conn.release("cell-key");
  });

  // A parked cell wakes on input (#992), so `onInput` has to mean "the user put something in" and
  // nothing else. It rides the one function every keystroke, bound key and paste funnels through
  // on the way to the socket — which is also why output arriving from the server cannot reach it.
  it("reports user input, and never reports it for output the server sends", () => {
    mockKeyState.handler = () => true;
    setTerminalSubmitMode("cr");
    const onInput = vi.fn();
    conn.attach("cell-input", target(null), { onSession: vi.fn(), onCwd: vi.fn(), onInput }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "hello from the agent" }) } as MessageEvent);
    expect(onInput).not.toHaveBeenCalled();

    const shiftEnter = {
      type: "keydown",
      key: "Enter",
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      preventDefault: vi.fn(),
    };
    mockKeyState.handler(shiftEnter);
    expect(onInput).toHaveBeenCalled();
    conn.release("cell-input");
  });

  it("blocks xterm and programmatic input while one cell awaits confirmed Delete", () => {
    const key = "cell-deleting";
    conn.attach(key, target("session-delete"), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    conn.setInputEnabled(key, false);
    expect(mockTermState.options.disableStdin).toBe(true);
    mockTermState.emitData("x");
    expect(conn.submitText(key, "/commit")).toBe(false);
    expect(conn.pasteText(key, "blocked paste")).toBe(false);
    expect(conn.pasteAndSubmit(key, "blocked submit")).toBe(false);
    conn.insertText(key, "blocked");
    expect(ws.sent.filter((frame) => JSON.parse(frame).type === "input")).toHaveLength(0);

    conn.setInputEnabled(key, true);
    expect(mockTermState.options.disableStdin).toBe(false);
    mockTermState.emitData("y");
    expect(ws.sent).toContain(JSON.stringify({ type: "input", data: "y" }));
    conn.release(key);
  });

  // Clicking a parked cell to READ it must leave it parked — but a click on a mouse-tracking app
  // is delivered as input on the very channel keystrokes use, which is what made the cell wake on
  // the click rather than on the typing. The report still reaches the PTY; it just is not the
  // user typing.
  it("forwards a pointer report to the PTY without calling it user input", () => {
    const onInput = vi.fn();
    conn.attach("cell-click", target(null), { onSession: vi.fn(), onCwd: vi.fn(), onInput }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    const [press] = clickReportSequences(4, 9);
    mockTermState.emitData(press);
    expect(ws.sent).toContain(JSON.stringify({ type: "input", data: press }));
    expect(onInput).not.toHaveBeenCalled();

    mockTermState.emitData("x");
    expect(onInput).toHaveBeenCalledTimes(1);
    conn.release("cell-click");
  });

  it("wires the Enter handler through ensure() (esc-cr mode): submits a bare Enter with \\x1b\\r and makes Shift+Enter a \\r newline", () => {
    mockKeyState.handler = () => true;
    setTerminalSubmitMode("esc-cr");
    try {
      conn.attach("cell-esc", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
      const ws = FakeWebSocket.instances.at(-1);
      if (!ws) throw new Error("no socket created");
      ws.onopen?.();

      // Bare Enter → submit (ESC+CR), default cancelled.
      const enter = {
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(enter)).toBe(false);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: submitSequence("esc-cr") }));

      // Shift+Enter → newline (CR).
      ws.sent.length = 0;
      const shiftEnter = {
        type: "keydown",
        key: "Enter",
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(shiftEnter)).toBe(false);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: newlineSequence("esc-cr") }));

      // An IME candidate-confirm Enter must NOT be eaten as a submit — the guard that
      // protects Japanese input in the one mode where a bare Enter is intercepted.
      ws.sent.length = 0;
      const composing = {
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: true,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(composing)).toBe(true);
      expect(ws.sent).toHaveLength(0);

      conn.release("cell-esc");
    } finally {
      setTerminalSubmitMode("cr"); // module global — reset so later tests see the default
    }
  });

  it("does NOT apply esc-cr to a shell cell — a bare Enter stays native \\r (scoped to Claude sessions)", () => {
    mockKeyState.handler = () => true;
    setTerminalSubmitMode("esc-cr");
    try {
      const shellTarget = { ...target(null), launcher: { shell: true as const } };
      conn.attach("cell-shell", shellTarget, { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
      const ws = FakeWebSocket.instances.at(-1);
      if (!ws) throw new Error("no socket created");
      ws.onopen?.();
      ws.sent.length = 0; // drop the socket's init sends so we only see what the key emits

      // A shell's bare Enter must NOT be rewritten to ESC+CR — it stays xterm's native \r.
      const enter = {
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(enter)).toBe(true); // passes through to xterm
      expect(ws.sent).toHaveLength(0);

      // Shift+Enter keeps the standard newline (ESC+CR), same as before the setting existed.
      const shiftEnter = {
        type: "keydown",
        key: "Enter",
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(shiftEnter)).toBe(false);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: newlineSequence("cr") }));

      conn.release("cell-shell");
    } finally {
      setTerminalSubmitMode("cr");
    }
  });

  it("captures the last Shell launcher command and multiline output from the xterm buffer", () => {
    const shellTarget = { ...target(null), launcher: { shell: true as const } };
    conn.attach("cell-shell-copy", shellTarget, { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    expect(conn.connView.get("cell-shell-copy")?.lastCommandCopyText).toBe("");
    mockTermState.emitData("echo hi");
    mockTermState.bufferLines = ["user@host:/repo$ echo hi"];
    mockTermState.emitData("\r");
    expect(conn.connView.get("cell-shell-copy")?.lastCommandCopyText).toBe("");

    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "\r\nhi\r\nagain\r\nuser@host:/repo$ " }) } as MessageEvent);

    expect(conn.connView.get("cell-shell-copy")?.lastCommandCopyText).toBe("user@host:/repo$ echo hi\nhi\nagain");
    conn.release("cell-shell-copy");
  });

  it("updates the Shell launcher copy target on the next command, including output-free commands", () => {
    const shellTarget = { ...target(null), launcher: { shell: true as const } };
    conn.attach("cell-shell-next", shellTarget, { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    mockTermState.emitData("echo hi");
    mockTermState.bufferLines = ["user@host:/repo$ echo hi"];
    mockTermState.emitData("\r");
    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "\r\nhi\r\nuser@host:/repo$ " }) } as MessageEvent);
    expect(conn.connView.get("cell-shell-next")?.lastCommandCopyText).toBe("user@host:/repo$ echo hi\nhi");

    mockTermState.emitData("true");
    mockTermState.bufferLines = ["user@host:/repo$ echo hi", "hi", "user@host:/repo$ true"];
    mockTermState.emitData("\r");
    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "\r\nuser@host:/repo$ " }) } as MessageEvent);

    expect(conn.connView.get("cell-shell-next")?.lastCommandCopyText).toBe("user@host:/repo$ true");
    conn.release("cell-shell-next");
  });

  it("keeps ANSI color codes out of Shell launcher copy text", () => {
    const shellTarget = { ...target(null), launcher: { shell: true as const } };
    conn.attach("cell-shell-ansi", shellTarget, { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    mockTermState.emitData("printf red");
    mockTermState.bufferLines = ["user@host:/repo$ printf red"];
    mockTermState.emitData("\r");
    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "\r\n\u001b[31mred\u001b[0m\r\nuser@host:/repo$ " }) } as MessageEvent);

    expect(conn.connView.get("cell-shell-ansi")?.lastCommandCopyText).toBe("user@host:/repo$ printf red\nred");
    conn.release("cell-shell-ansi");
  });

  it("keeps long Shell launcher output in the copy target without depending on scrollback", () => {
    const shellTarget = { ...target(null), launcher: { shell: true as const } };
    conn.attach("cell-shell-long", shellTarget, { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    mockTermState.emitData("seq 1 1200");
    mockTermState.bufferLines = ["user@host:/repo$ seq 1 1200"];
    mockTermState.emitData("\r");
    const output = Array.from({ length: 1200 }, (_, i) => String(i + 1)).join("\r\n");
    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: `\r\n${output}\r\nuser@host:/repo$ ` }) } as MessageEvent);

    const copied = conn.connView.get("cell-shell-long")?.lastCommandCopyText ?? "";
    expect(copied.startsWith("user@host:/repo$ seq 1 1200\n1\n2\n3")).toBe(true);
    expect(copied.endsWith("\n1198\n1199\n1200")).toBe(true);
    conn.release("cell-shell-long");
  });

  it("does not capture last-command copy text for non-Shell launcher cells and clears it on retarget", () => {
    conn.attach(
      "cell-shell-mix",
      { ...target(null), launcher: { shell: true as const } },
      { onSession: vi.fn(), onCwd: vi.fn() },
      document.createElement("div"),
    );
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();
    mockTermState.emitData("pwd");
    mockTermState.bufferLines = ["user@host:/repo$ pwd"];
    mockTermState.emitData("\r");
    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "\r\n/repo\r\nuser@host:/repo$ " }) } as MessageEvent);
    expect(conn.connView.get("cell-shell-mix")?.lastCommandCopyText).toContain("pwd");

    conn.retarget("cell-shell-mix", { ...target("next"), launcher: { index: 1 } });
    expect(conn.connView.get("cell-shell-mix")?.lastCommandCopyText).toBe("");
    mockTermState.bufferLines = ["codex prompt"];
    mockTermState.emitData("hello\r");
    expect(conn.connView.get("cell-shell-mix")?.lastCommandCopyText).toBe("");
    conn.release("cell-shell-mix");
  });

  it("configures xterm with macOptionIsMeta so macOS Option acts as Meta (Alt bindings reach the PTY)", () => {
    mockTermState.options = {};
    conn.attach("cell-opt", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    expect(mockTermState.options.macOptionIsMeta).toBe(true);
    conn.release("cell-opt");
  });

  // Selecting text must not hand the drag to the agent as mouse reports (#729). `allowProposedApi`
  // is load-bearing rather than cosmetic: `term.parser` throws without it, so a terminal would fail
  // to construct at all. macOptionClickForcesSelection is the macOS escape hatch — there, xterm
  // bypasses mouse mode for Option+drag ONLY when it is set (elsewhere Shift needs no option).
  it("registers the mouse-tracking guard on DECSET and DECRST, with the options it needs", () => {
    mockTermState.options = {};
    mockTermState.csiHandlers = [];
    conn.attach("cell-mouse", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    expect(mockTermState.options.allowProposedApi).toBe(true);
    expect(mockTermState.options.macOptionClickForcesSelection).toBe(true);
    // SET swallows; RESET is only observed (must keep returning false) so the wheel-report
    // record can follow the app's own mode teardown (#737) — see mouseTrackingGuard.spec.ts.
    expect(mockTermState.csiHandlers.map(([id]) => id)).toEqual([
      { prefix: "?", final: "h" },
      { prefix: "?", final: "l" },
    ]);
    conn.release("cell-mouse");
  });

  it("routes wheel through generic Core intent regardless of swallowed click modes", () => {
    vi.useFakeTimers();
    mockTermState.csiHandlers = [];
    mockTermState.input = [];
    mockTermState.bufferType = "alternate";
    mockTermState.wheelHandler = () => true;
    conn.attach("cell-race", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const first = FakeWebSocket.instances.at(-1);
    first?.onopen?.();

    const decset = mockTermState.csiHandlers.find(([id]) => (id as { final: string }).final === "h")?.[1] as (p: (number | number[])[]) => boolean;
    decset([1002, 1006]); // the app asks for drag tracking + SGR: swallowed, and remembered
    const wheel = mockTermState.wheelHandler;
    expect(wheel({ deltaY: 1, preventDefault: () => {} })).toBe(false);
    expect(mockTermState.input).toEqual([]);
    expect(first?.sent.map((frame) => JSON.parse(frame)).some((frame) => frame.type === "scroll")).toBe(true);

    // The app dies WITHOUT the matching DECRST and the socket drops; the slot reconnects.
    FakeWebSocket.instances.at(-1)?.onclose?.();
    vi.advanceTimersByTime(10_000);
    mockTermState.input = [];

    // A later app still uses generic intent; no browser-side mouse encoding is restored.
    const second = FakeWebSocket.instances.at(-1);
    second?.onopen?.();
    expect(wheel({ deltaY: 1, preventDefault: () => {} })).toBe(false);
    expect(mockTermState.input).toEqual([]);
    expect(second?.sent.map((frame) => JSON.parse(frame)).some((frame) => frame.type === "scroll")).toBe(true);
    vi.useRealTimers();
  });

  it("does not replay a session id before the server has assigned one", () => {
    const first = { onSession: vi.fn(), onCwd: vi.fn() };
    const el1 = document.createElement("div");
    conn.attach("cell-race", target(null), first, el1);
    FakeWebSocket.instances.at(-1)?.onopen?.();
    conn.detach("cell-race", el1);

    // No `session` message yet — reattaching must not synthesize a bogus id.
    const second = { onSession: vi.fn(), onCwd: vi.fn() };
    conn.attach("cell-race", target(null), second, document.createElement("div"));
    expect(second.onSession).not.toHaveBeenCalled();
    expect(second.onCwd).not.toHaveBeenCalled();
  });
});

// The load-bearing half of #860/#864, and the half nothing asserted until now: changing the font
// changes the CELL METRICS, so cols/rows change and the PTY has to be told. Delete the re-fit from
// setFont and every other test in this repo still passes, while the bug #860 was filed for — a
// canvas grid the shell disagrees with, so the cursor and wrap points drift — comes silently back.
//
// The observable contract is the resize frame on the wire, not a call count, so that is what these
// assert.
describe("setFont — a font change must reach the PTY, not just the canvas", () => {
  const FONT = { size: 14, family: "'JetBrains Mono', monospace" };
  const resizes = (ws: FakeWebSocket) => ws.sent.filter((m) => JSON.parse(m).type === "resize");

  function attachOpenSlot(key: string) {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    conn.attach(key, target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"), undefined, FONT);
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.(); // open, so fitAndSyncSize's readyState guard lets the resize through
    ws.sent.length = 0; // ignore the frames attach() itself produced
    return ws;
  }

  afterEach(() => {
    conn.release("cell-font");
  });

  it("applies BOTH options and pushes the new geometry to the PTY", () => {
    const ws = attachOpenSlot("cell-font");

    conn.setFont("cell-font", { size: 24, family: "'Songti SC', monospace" });

    expect(mockTermState.options.fontSize).toBe(24);
    expect(mockTermState.options.fontFamily).toBe("'Songti SC', monospace");
    expect(resizes(ws)).toHaveLength(1);
  });

  // A family alone moves the advance width just as a size does, so it must re-fit too — the case
  // #864 added and the one a size-only implementation would quietly miss.
  it("re-fits for a family change on its own, not only a size change", () => {
    const ws = attachOpenSlot("cell-font");

    conn.setFont("cell-font", { size: FONT.size, family: "'Songti SC', monospace" });

    expect(mockTermState.options.fontFamily).toBe("'Songti SC', monospace");
    expect(resizes(ws)).toHaveLength(1);
  });

  // Terminal.vue's watcher fires on every dir-config resolution, and most directories pin no font
  // at all. Re-fitting there would churn every terminal on every load for nothing.
  it("does nothing when the font is unchanged", () => {
    const ws = attachOpenSlot("cell-font");

    conn.setFont("cell-font", { ...FONT });

    expect(resizes(ws)).toHaveLength(0);
  });

  it("ignores a slot that does not exist rather than throwing", () => {
    expect(() => conn.setFont("cell-not-here", { size: 20, family: "monospace" })).not.toThrow();
  });
});

// The #846 recovery only runs when something calls it, and until now that was a fit or an incoming
// output frame. A cell that is idle gets neither — nothing writes to it, nothing resizes it — so a
// terminal whose write queue is stuck stayed stuck, and the user in front of it read "I type and
// nothing happens" as broken input. The keystroke itself is the missing trigger.
describe("a keystroke into a dead terminal triggers the #846 recovery", () => {
  const KEY = "cell-dead";

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    conn.release(KEY);
    // Shared double state: leave the buffer healthy for whatever runs next.
    mockTermState.bufferLength = 24;
  });

  // One task, because guardBufferHealth deliberately re-reads the shape after one: mid-parse a
  // healthy terminal can look short, and a rebuild costs the client-side scrollback.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("rebuilds the terminal and reconnects when the user types into a short buffer", async () => {
    conn.attach(KEY, target(null), {}, document.createElement("div"));
    FakeWebSocket.instances.at(-1)?.onopen?.();
    const built = mockTermState.constructed;
    const sockets = FakeWebSocket.instances.length;

    mockTermState.bufferLength = 10; // fewer lines than the 24 rows the viewport addresses
    mockTermState.emitData("a");
    await settle();

    expect(mockTermState.constructed).toBe(built + 1);
    expect(FakeWebSocket.instances).toHaveLength(sockets + 1); // the rebuild re-attaches the session
  });

  it("leaves a healthy terminal alone — a rebuild costs the scrollback, so typing must not cause one", async () => {
    conn.attach(KEY, target(null), {}, document.createElement("div"));
    FakeWebSocket.instances.at(-1)?.onopen?.();
    const built = mockTermState.constructed;

    mockTermState.emitData("a");
    await settle();

    expect(mockTermState.constructed).toBe(built);
  });

  // A pointer report is the app talking to itself, not someone typing — and a click on a parked
  // cell must stay as free of side effects as it is of waking it (#992).
  it("does not run the probe for a pointer report", async () => {
    conn.attach(KEY, target(null), {}, document.createElement("div"));
    FakeWebSocket.instances.at(-1)?.onopen?.();
    const built = mockTermState.constructed;

    mockTermState.bufferLength = 10;
    mockTermState.emitData(clickReportSequences(1, 1)[0]);
    await settle();

    expect(mockTermState.constructed).toBe(built);
  });
});

// A keystroke that reaches a closed socket is dropped, and nothing about the terminal changes when
// it is — the same silence a working terminal produces for a key it chose not to echo. The view
// gets told so it can say so; the rate limit is what keeps a held-down key from becoming a stream
// of notices.
describe("a keystroke with nowhere to go tells the view", () => {
  const KEY = "cell-dropped";
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    conn.release(KEY);
  });

  function attachClosedSlot(onInputDropped: (willReconnect: boolean) => void, over: Partial<conn.ConnTarget> = {}) {
    conn.attach(KEY, { ...target(null), ...over }, { onInputDropped }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();
    ws.close(); // the drop / reconnect state the reconnect backoff leaves a cell in
    return ws;
  }

  const droppedInputLines = () => warn.mock.calls.filter((args: unknown[]) => String(args[0]).includes("dropped input"));

  it("reports once while the notice is still on screen, however much the user types", () => {
    const onInputDropped = vi.fn();
    attachClosedSlot(onInputDropped);

    mockTermState.emitData("h");
    mockTermState.emitData("i");

    expect(onInputDropped).toHaveBeenCalledOnce();
  });

  it("still reports typed activity while the socket is reconnecting", () => {
    const onInput = vi.fn();
    const onInputDropped = vi.fn();
    conn.attach(KEY, target(null), { onInput, onInputDropped }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();
    ws.close();

    mockTermState.emitData("h");

    expect(onInput).toHaveBeenCalledOnce();
    expect(onInputDropped).toHaveBeenCalledOnce();
  });

  // A stretch has no upper bound — the backoff retries forever at a 5s cap — so "once per stretch"
  // meant a server left down said it once and never again, and whoever came back and typed got the
  // silence this notice exists to break (#1316). The log line is the one that stays single: it is
  // read afterwards, where a repeat adds nothing.
  it("reports again once the notice has left the screen, though the stretch is the same", () => {
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000);
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);
      mockTermState.emitData("h");

      now.mockReturnValue(1_006_000); // the banner's six seconds are up
      mockTermState.emitData("h");

      expect(onInputDropped).toHaveBeenCalledTimes(2);
      expect(droppedInputLines()).toHaveLength(1);
    } finally {
      now.mockRestore();
    }
  });

  it("reports again after a reconnect, because that is a new stretch", () => {
    const onInputDropped = vi.fn();
    const ws = attachClosedSlot(onInputDropped);
    mockTermState.emitData("h");

    ws.readyState = FakeWebSocket.OPEN;
    ws.onopen?.(); // reconnected: whatever is typed now lands
    ws.close(); // …and dropped again
    mockTermState.emitData("h");

    expect(onInputDropped).toHaveBeenCalledTimes(2);
  });

  it("says a reconnect is coming for an ordinary drop", () => {
    const onInputDropped = vi.fn();
    attachClosedSlot(onInputDropped);

    mockTermState.emitData("h");

    expect(onInputDropped).toHaveBeenCalledWith(true);
  });

  // The banner promises "Reconnecting…" off this flag, and an exited session gets no reconnect —
  // shouldReconnect refuses one for sawExit. Telling the user to wait for something that is never
  // coming swaps one misleading silence for another, which is what this notice exists to prevent.
  it("says no reconnect is coming once the session has exited", () => {
    const onInputDropped = vi.fn();
    const ws = attachClosedSlot(onInputDropped);
    ws.onmessage?.({ data: JSON.stringify({ type: "exit", exitCode: 0 }) } as MessageEvent);

    mockTermState.emitData("h");

    expect(onInputDropped).toHaveBeenCalledWith(false);
  });

  // A Run cell's process is unresumable, so the same promise would be just as empty.
  it("says no reconnect is coming for a Run cell", () => {
    const onInputDropped = vi.fn();
    attachClosedSlot(onInputDropped, { command: { source: "script", index: 0, label: "echo", cwd: null } });

    mockTermState.emitData("h");

    expect(onInputDropped).toHaveBeenCalledWith(false);
  });

  // Same reason the probe skips them: a click on a parked cell is the app talking, not a person
  // typing, and it must not raise a notice about input nobody gave (#992).
  it("says nothing for a pointer report", () => {
    const onInputDropped = vi.fn();
    attachClosedSlot(onInputDropped);

    mockTermState.emitData(clickReportSequences(1, 1)[0]);

    expect(onInputDropped).not.toHaveBeenCalled();
  });

  // The GUI reaches the same socket without going through the keyboard: a header button's text, a
  // skill picked from the menu, a pasted block. Those returned `false` and told nobody, and the one
  // caller that read the result was the exception (#1315) — so the report belongs in the manager,
  // where every host gets it, rather than in each caller that remembers to ask.
  describe("input the GUI sends", () => {
    it("tells the view when a button's text hits a closed socket", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);

      expect(conn.submitText(KEY, "/commit")).toBe(false);

      expect(onInputDropped).toHaveBeenCalledWith(true);
    });

    it("tells the view when a paste hits a closed socket", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);

      expect(conn.pasteText(KEY, "a block")).toBe(false);

      expect(onInputDropped).toHaveBeenCalledWith(true);
    });

    it("tells the view when a paste-and-submit hits a closed socket", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);

      expect(conn.pasteAndSubmit(KEY, "a block")).toBe(false);

      expect(onInputDropped).toHaveBeenCalledWith(true);
    });

    // The quietest one: a dictated sentence, a dropped path, a pasted screenshot's path. The user
    // is watching the input box for text to appear, so nothing about the terminal changes at all.
    it("tells the view when inserted text hits a closed socket", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);

      conn.insertText(KEY, "~/shots/pasted.png ");

      expect(onInputDropped).toHaveBeenCalledWith(true);
    });

    // Empty text never had anything to deliver, so its `false` is not a drop — reporting it would
    // put a "not connected" banner on a paste of nothing.
    it("says nothing for empty text", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped);

      expect(conn.pasteText(KEY, "")).toBe(false);
      expect(conn.pasteAndSubmit(KEY, "")).toBe(false);
      conn.insertText(KEY, "");

      expect(onInputDropped).not.toHaveBeenCalled();
    });

    // The same "nothing is coming" the keyboard gets, since the wording follows the flag: a Run
    // cell's button must not be told to wait for a reconnect that would re-run its command.
    it("says no reconnect is coming for a Run cell", () => {
      const onInputDropped = vi.fn();
      attachClosedSlot(onInputDropped, { command: { source: "script", index: 0, label: "echo", cwd: null } });

      expect(conn.submitText(KEY, "/commit")).toBe(false);

      expect(onInputDropped).toHaveBeenCalledWith(false);
    });
  });
});
