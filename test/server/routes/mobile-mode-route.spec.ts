// @vitest-environment node
//
// GET /api/mobile-mode's contract: it echoes MOBILE_MODE (server/config/env.ts, itself decided
// once from MULMOTERMINAL_MOBILE_MODE at import time) and nothing else — no Firebase connection
// state belongs here, that stays behind /api/remote-host/status. Reloaded per test the same way
// mobile-mode-env.spec.ts reloads env.ts, since MOBILE_MODE is fixed at import time.
import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const original = process.env.MULMOTERMINAL_MOBILE_MODE;

async function appFor(mode: "remote" | "local") {
  process.env.MULMOTERMINAL_MOBILE_MODE = mode;
  vi.resetModules();
  const { mountMobileModeRoute } = await import("../../../server/routes/mobile-mode-route.js");
  const app = express();
  mountMobileModeRoute(app);
  return app;
}

afterEach(() => {
  if (original === undefined) delete process.env.MULMOTERMINAL_MOBILE_MODE;
  else process.env.MULMOTERMINAL_MOBILE_MODE = original;
});

describe("GET /api/mobile-mode", () => {
  it("answers remote", async () => {
    const res = await request(await appFor("remote")).get("/api/mobile-mode");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: "remote" });
  });

  it("answers local", async () => {
    const res = await request(await appFor("local")).get("/api/mobile-mode");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: "local" });
  });

  it("carries nothing about Firebase connection state", async () => {
    const res = await request(await appFor("remote")).get("/api/mobile-mode");
    expect(Object.keys(res.body)).toEqual(["mode"]);
  });
});
