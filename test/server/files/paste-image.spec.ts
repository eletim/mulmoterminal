import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { mountPasteImageRoute, MAX_PASTE_IMAGE_BYTES } from "../../../server/files/paste-image";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function appWith(dir: string, token = () => "ab12cd34") {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  mountPasteImageRoute(app, { dir, now: () => new Date(2026, 6, 27, 9, 5, 3, 7), token });
  return app;
}

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-paste-route-"));

describe("POST /api/paste-image", () => {
  it("saves the image and answers with its ABSOLUTE path — the string that goes into the terminal", async () => {
    const dir = tmp();
    const res = await request(appWith(dir))
      .post("/api/paste-image")
      .send({ dataUrl: `data:image/png;base64,${PNG_BASE64}` });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(path.join(dir, "pasted-20260727-090503-007-ab12cd34.png"));
    expect(path.isAbsolute(res.body.path)).toBe(true);
    expect(readFileSync(res.body.path).subarray(1, 4).toString()).toBe("PNG");
    rmSync(dir, { recursive: true, force: true });
  });

  // Codex review: the millisecond alone is not unique, and the second write's rename would
  // silently take over the first path — the first terminal then points at the wrong image.
  it("keeps two pastes that land in the same millisecond apart", async () => {
    const dir = tmp();
    const tokens = ["aaaaaaaa", "bbbbbbbb"];
    const app = appWith(dir, () => tokens.shift() ?? "cccccccc");
    const first = await request(app)
      .post("/api/paste-image")
      .send({ dataUrl: `data:image/png;base64,${PNG_BASE64}` });
    const second = await request(app)
      .post("/api/paste-image")
      .send({ dataUrl: `data:image/png;base64,${PNG_BASE64}` });
    expect(first.body.path).not.toBe(second.body.path);
    expect(readdirSync(dir).sort()).toEqual(["pasted-20260727-090503-007-aaaaaaaa.png", "pasted-20260727-090503-007-bbbbbbbb.png"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a body without a dataUrl", async () => {
    const dir = tmp();
    const res = await request(appWith(dir)).post("/api/paste-image").send({});
    expect(res.status).toBe(400);
    expect(readdirSync(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a non-image data URL", async () => {
    const dir = tmp();
    const res = await request(appWith(dir)).post("/api/paste-image").send({ dataUrl: "data:text/plain;base64,aGk=" });
    expect(res.status).toBe(400);
    expect(readdirSync(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects an image past the size cap with 413", async () => {
    const dir = tmp();
    const oversized = Buffer.alloc(MAX_PASTE_IMAGE_BYTES + 1, 0).toString("base64");
    const res = await request(appWith(dir))
      .post("/api/paste-image")
      .send({ dataUrl: `data:image/png;base64,${oversized}` });
    expect(res.status).toBe(413);
    expect(readdirSync(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  // The directory is housekept and lives under the app's home, so it can be gone by the time
  // someone pastes. Re-creating it beats failing the paste.
  it("recreates the directory when it has disappeared", async () => {
    const dir = tmp();
    rmSync(dir, { recursive: true, force: true });
    const res = await request(appWith(dir))
      .post("/api/paste-image")
      .send({ dataUrl: `data:image/png;base64,${PNG_BASE64}` });
    expect(res.status).toBe(200);
    expect(readdirSync(dir)).toEqual(["pasted-20260727-090503-007-ab12cd34.png"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers 500 rather than a path when the image cannot be written", async () => {
    const dir = tmp();
    const blocker = path.join(dir, "blocker");
    writeFileSync(blocker, "not a directory");
    const res = await request(appWith(path.join(blocker, "pasted")))
      .post("/api/paste-image")
      .send({ dataUrl: `data:image/png;base64,${PNG_BASE64}` });
    expect(res.status).toBe(500);
    rmSync(dir, { recursive: true, force: true });
  });
});
