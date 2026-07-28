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
