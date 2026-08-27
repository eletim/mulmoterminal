// @vitest-environment node
// #1151: a `?cwd=` that names a directory the server cannot enter must not become the DEFAULT
// workspace in silence. Until this, `resolveWorkspace` swapped the path before anything else saw
// it, so the terminal came up in another project and `ptySpawn`'s own refusal (#1078) could never
// fire on this path — which is what left #1146 with no symptom but "it opened somewhere else".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";

const coreIds = vi.hoisted(() => new Set<string>());
vi.mock("../../../server/session/core-session-adapter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/session/core-session-adapter.js")>();
  return {
    ...actual,
    coreSessions: {
      find: async (id: string) => (coreIds.has(id) ? { id, cwd: "/wherever" } : null),
      findByReference: async (id: string) => (coreIds.has(id) ? { id, cwd: "/wherever" } : null),
    },
  };
});

const { workspaceFromUrl, refuseUnusableWorkspace } = await import("../../../server/routes/ws-routes.js");
const { viewerPtys } = await import("../../../server/session/registry.js");
const { CLAUDE_CWD } = await import("../../../server/config/env.js");

// Just the two members closeWithError touches, plus a record of what it sent.
function fakeWs() {
  const sent: string[] = [];
  let closed = false;
  return {
    sent,
    get closed() {
      return closed;
    },
    readyState: 1,
    OPEN: 1,
    send: (raw: string) => sent.push(raw),
    close: () => (closed = true),
  };
}
const errorFrom = (ws: ReturnType<typeof fakeWs>) => JSON.parse(ws.sent[0] ?? "{}");

const urlWith = (cwd: string | null) => {
  const query = cwd === null ? "" : `?cwd=${encodeURIComponent(cwd)}`;
  return new URL(`ws://localhost/ws${query}`);
};

const SESSION = "11111111-2222-3333-4444-555555555555";
let dir = "";

beforeEach(() => {
  coreIds.clear();
  viewerPtys.clear();
  dir = mkdtempSync(path.join(tmpdir(), "mt-wscwd-"));
});
afterEach(() => {
  viewerPtys.clear();
  rmSync(dir, { recursive: true, force: true });
});

describe("workspaceFromUrl", () => {
  it("resolves a real directory and names no problem", () => {
    expect(workspaceFromUrl(urlWith(dir))).toEqual({ cwd: dir, unusable: null });
  });

  it("answers the default workspace when the socket names no directory", () => {
    expect(workspaceFromUrl(urlWith(null))).toEqual({ cwd: CLAUDE_CWD, unusable: null });
  });

  // `URLSearchParams.get` would take the first of the two and start there — the silent pick this
  // whole change exists to stop, and the HTTP routes already refuse it. One rule, both transports.
  it("refuses a repeated ?cwd= instead of taking the first one", () => {
    const url = new URL(`ws://localhost/ws?cwd=${encodeURIComponent(dir)}&cwd=${encodeURIComponent("/tmp")}`);
    const { cwd, unusable } = workspaceFromUrl(url);
    expect(cwd).toBe(CLAUDE_CWD);
    expect(unusable).toContain("exactly once");
  });

  // The default still comes back as the cwd — a reattach is allowed to proceed on it, and handing
  // tmux a directory that is not there would break the one path this must not break.
  it("reports a problem for a directory that is not there, keeping the default as the cwd", () => {
    const gone = path.join(dir, "gone");
    const { cwd, unusable } = workspaceFromUrl(urlWith(gone));
    expect(cwd).toBe(CLAUDE_CWD);
    expect(unusable).toContain(gone);
    expect(unusable).toContain("no longer exists");
  });
});

describe("refuseUnusableWorkspace", () => {
  it("lets a connection through when the directory is fine", async () => {
    const ws = fakeWs();
    expect(await refuseUnusableWorkspace(ws as unknown as WebSocket, "claude", null, null)).toBe(false);
    expect(ws.sent).toEqual([]);
  });

  // The bug this exists for: a FRESH start in a directory that is not there used to open the
  // default workspace instead. The reason reaches the cell as an error frame, which the browser
  // renders as the red banner and does not retry.
  it("refuses a fresh start and sends the reason to the cell", async () => {
    const ws = fakeWs();
    const refused = await refuseUnusableWorkspace(ws as unknown as WebSocket, "claude", "The directory /gone no longer exists…", null);
    expect(refused).toBe(true);
    expect(errorFrom(ws)).toEqual({ type: "error", message: "The directory /gone no longer exists…" });
    expect(ws.closed).toBe(true);
  });

  it("refuses a fresh start even when a session id is offered but Core has no member", async () => {
    const ws = fakeWs();
    expect(await refuseUnusableWorkspace(ws as unknown as WebSocket, "codex", "gone", SESSION)).toBe(true);
    expect(ws.closed).toBe(true);
  });

  // Refusing here would shut someone out of an agent that is still running because they moved or
  // renamed its directory — a worse bug than the one being reported. The same call `ptySpawn`
  // makes for a reattach (refuseUnusableCwd) reaches the same verdict.
  it("does not let a stray PTY manufacture membership", async () => {
    const ws = fakeWs();
    viewerPtys.set(SESSION, { cwd: "/wherever" } as never);
    expect(await refuseUnusableWorkspace(ws as unknown as WebSocket, "claude", "gone", SESSION)).toBe(true);
    expect(ws.closed).toBe(true);
  });

  it("lets a surviving Core session reattach despite an unusable directory", async () => {
    const ws = fakeWs();
    coreIds.add(SESSION);
    expect(await refuseUnusableWorkspace(ws as unknown as WebSocket, "launch", "gone", SESSION)).toBe(false);
    expect(ws.sent).toEqual([]);
  });
});
