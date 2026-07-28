// @vitest-environment node
// The /api/pr-phase contract, pinned at the route. The handler answers from two places — a
// resolved GitHub branch, and the "this dir has no repo/remote" shortcut — and those used to
// return different shapes, the shortcut still sending the pre-#979 `{ phase, url }` (Codex
// review). A client written against the typed shape would read `undefined` from it, and nothing
// in the type system says so, because the route hands express a plain object.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { mountDirRoutes } from "../../../server/routes/dir-routes";
import { EMPTY_WORK_ITEM } from "../../../common/prPhase";

const app = express();
app.use(express.json());
mountDirRoutes(app);

describe("GET /api/pr-phase", () => {
  it("answers the full WorkItem shape for a directory that is not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-prphase-"));
    try {
      const res = await request(app).get("/api/pr-phase").query({ cwd: dir });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(EMPTY_WORK_ITEM);
      // Named individually so a future shape change has to face each field, not just a deep-equal.
      expect(Object.keys(res.body).sort()).toEqual(["issue", "issueUrl", "phase", "pr", "prUrl"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The write half (#979 Phase 2). The setting is off in a test process (no config file has been
// loaded with it on), which is also the shipped default — so these pin that a client asking blind
// gets a plain "no" and nothing reaches GitHub.
describe("POST /api/work-comment", () => {
  it("writes nothing while the setting is off, and says why", async () => {
    const res = await request(app).post("/api/work-comment").send({ cwd: process.cwd(), issue: 979, kind: "start" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ posted: false, reason: "disabled" });
  });

  it.each([
    ["an unknown kind", { issue: 979, kind: "shipped" }],
    ["no kind", { issue: 979 }],
    ["no issue", { kind: "start" }],
    ["issue zero", { issue: 0, kind: "start" }],
    ["a fractional issue", { issue: 1.5, kind: "start" }],
    ["an issue that is not a number", { issue: "979", kind: "start" }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await request(app).post("/api/work-comment").send(body);
    expect(res.status).toBe(400);
  });
});
