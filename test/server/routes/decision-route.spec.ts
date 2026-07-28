// @vitest-environment node
// The /api/decisions contract, pinned at the route. This endpoint REPORTS ON the directory it was
// asked about, so resolving an unusable `cwd` to the default workspace would answer with another
// project's decisions under this project's name (Codex review) — and a stale preset pointing at a
// deleted project is exactly when that happens. The answer keeps its shape either way: a route
// that changes shape by branch is the trap #979 already walked into.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { mountDecisionRoutes, NO_DECISIONS } from "../../../server/routes/decision-routes";

const app = express();
mountDecisionRoutes(app);

const get = (query: Record<string, string>) => request(app).get("/api/decisions").query(query);

describe("GET /api/decisions", () => {
  it("answers empty — never the default workspace's decisions — for a directory that does not exist", async () => {
    const res = await get({ cwd: path.join(tmpdir(), "mt-decisions-gone-12345") });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(NO_DECISIONS);
  });

  it("answers empty when no cwd is given at all", async () => {
    const res = await get({});
    expect(res.body).toEqual(NO_DECISIONS);
  });

  it("answers empty for a relative path and for a path that is a file, not a directory", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-decisions-"));
    const file = path.join(dir, "not-a-dir.txt");
    writeFileSync(file, "x");
    try {
      expect((await get({ cwd: "relative/path" })).body).toEqual(NO_DECISIONS);
      expect((await get({ cwd: file })).body).toEqual(NO_DECISIONS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers the same shape for a real directory that simply has no sessions", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-decisions-"));
    try {
      const res = await get({ cwd: dir });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ decisions: [], scanned: 0, unreadable: 0 });
      // Named individually so a future shape change has to face each field.
      expect(Object.keys(res.body).sort()).toEqual(["decisions", "scanned", "unreadable"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
