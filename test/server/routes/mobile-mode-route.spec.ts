// @vitest-environment node
//
// GET /api/mobile-mode's contract: it echoes the local-only MOBILE_MODE (server/config/env.ts).
import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const original = process.env.MULMOTERMINAL_MOBILE_MODE;

async function appFor(mode: "local" | undefined = "local") {
  if (mode === undefined) delete process.env.MULMOTERMINAL_MOBILE_MODE;
  else process.env.MULMOTERMINAL_MOBILE_MODE = mode;
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
  it("answers local", async () => {
    const res = await request(await appFor("local")).get("/api/mobile-mode");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: "local" });
  });

  it("defaults to local when unset", async () => {
    const res = await request(await appFor(undefined)).get("/api/mobile-mode");
    expect(Object.keys(res.body)).toEqual(["mode"]);
    expect(res.body).toEqual({ mode: "local" });
  });
});
