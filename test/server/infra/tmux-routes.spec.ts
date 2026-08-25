// @vitest-environment node
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { mountTmuxRoutes } from "../../../server/infra/tmux-routes.js";

const ID = "11111111-2222-4333-8444-555555555555";

function appFor(deleteSession = vi.fn(async () => undefined)) {
  const app = express();
  mountTmuxRoutes(app, {
    isAllowedOrigin: () => true,
    isValidSessionId: (id) => id === ID,
    deleteSession,
  });
  return { app, deleteSession };
}

describe("POST /api/session/:id/terminate", () => {
  it("deletes canonical membership through Core", async () => {
    const { app, deleteSession } = appFor();
    const response = await request(app).post(`/api/session/${ID}/terminate`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(deleteSession).toHaveBeenCalledExactlyOnceWith(ID);
  });

  it("rejects an invalid id before calling Core", async () => {
    const { app, deleteSession } = appFor();
    const response = await request(app).post("/api/session/not-an-id/terminate");
    expect(response.status).toBe(400);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("reports a Core delete conflict", async () => {
    const { app } = appFor(vi.fn(async () => Promise.reject(new Error("session not found"))));
    const response = await request(app).post(`/api/session/${ID}/terminate`);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "session not found" });
  });
});
