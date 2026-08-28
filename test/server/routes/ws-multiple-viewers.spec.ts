// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { attachViewer } from "../../../server/routes/ws-routes.js";
import type { PtyEntry } from "../../../server/session/types.js";

const SESSION = "11111111-2222-3333-4444-555555555555";

function entry(ws: object | null): PtyEntry {
  return { ws, cwd: "/repo", agent: "shell", term: {} } as unknown as PtyEntry;
}

describe("attachViewer", () => {
  it("creates an independent tmux client when another browser is already live", () => {
    const currentWs = { readyState: 1, OPEN: 1 };
    const nextWs = {};
    const current = entry(currentWs);
    const secondary = entry(nextWs);
    const deps = { spawnViewerPty: vi.fn(() => secondary), reattachPty: vi.fn(() => current) };

    expect(attachViewer(deps as never, current, nextWs as never, SESSION)).toBe(secondary);
    expect(deps.spawnViewerPty).toHaveBeenCalledWith(SESSION, nextWs, "/repo", "shell");
    expect(deps.reattachPty).not.toHaveBeenCalled();
  });

  it("reuses a detached primary transport for same-viewer reconnect", () => {
    const nextWs = {};
    const current = entry(null);
    const deps = { spawnViewerPty: vi.fn(), reattachPty: vi.fn(() => current) };

    expect(attachViewer(deps as never, current, nextWs as never, SESSION)).toBe(current);
    expect(deps.reattachPty).toHaveBeenCalledWith(current, nextWs, SESSION);
    expect(deps.spawnViewerPty).not.toHaveBeenCalled();
  });
});
