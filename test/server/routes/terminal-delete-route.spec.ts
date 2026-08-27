// @vitest-environment node
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { mountTerminalDeleteRoute } from "../../../server/routes/terminal-delete-route.js";

const ID = "11111111-2222-4333-8444-555555555555";
class MissingSessionError extends Error {}

function appFor(deleteSession: (id: string) => Promise<void> = vi.fn(async () => undefined), isAllowedOrigin = () => true) {
  const app = express();
  mountTerminalDeleteRoute(app, {
    isAllowedOrigin,
    isValidSessionId: (id) => id === ID,
    deleteSession,
    isSessionMissingError: (error) => error instanceof MissingSessionError,
  });
  return { app, deleteSession };
}

describe("DELETE /api/session/:id", () => {
  it("waits for canonical membership deletion through Core and reports success", async () => {
    let resolveDelete!: () => void;
    const deletePending = new Promise<void>((resolve) => (resolveDelete = resolve));
    const { app, deleteSession } = appFor(vi.fn(() => deletePending));
    let responseSettled = false;
    const responsePromise = request(app)
      .delete(`/api/session/${ID}`)
      .then((response) => {
        responseSettled = true;
        return response;
      });
    await vi.waitFor(() => expect(deleteSession).toHaveBeenCalledExactlyOnceWith(ID));
    expect(responseSettled).toBe(false);
    resolveDelete();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: true });
  });

  it("deletes an exited Core session by the same unconditional path", async () => {
    const { app, deleteSession } = appFor();
    const response = await request(app).delete(`/api/session/${ID}`);
    expect(response.status).toBe(200);
    expect(deleteSession).toHaveBeenCalledExactlyOnceWith(ID);
  });

  it("rejects an invalid id before calling Core", async () => {
    const { app, deleteSession } = appFor();
    const response = await request(app).delete("/api/session/not-an-id");
    expect(response.status).toBe(400);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin Delete before calling Core", async () => {
    const deleteSession = vi.fn(async () => undefined);
    const { app } = appFor(deleteSession, () => false);
    const response = await request(app).delete(`/api/session/${ID}`).set("origin", "https://evil.example");
    expect(response.status).toBe(403);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("reports a Core Delete failure without claiming deletion", async () => {
    const { app } = appFor(vi.fn(async () => Promise.reject(new Error("session not found"))));
    const response = await request(app).delete(`/api/session/${ID}`);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "session not found" });
  });

  it("confirms an idempotent retry when Core already reports the session absent", async () => {
    const { app, deleteSession } = appFor(vi.fn(async () => Promise.reject(new MissingSessionError("session not found"))));
    const response = await request(app).delete(`/api/session/${ID}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: true });
    expect(deleteSession).toHaveBeenCalledExactlyOnceWith(ID);
  });
});
