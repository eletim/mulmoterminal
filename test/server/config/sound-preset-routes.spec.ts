// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSoundPreset, SOUNDS_DIR } from "../../../server/config/sound-presets.js";
import { soundPresetById } from "../../../common/notifySounds.js";

// What a preset route answers when it has no bytes, which decides whether the BROWSER ever
// asks again: it remembers a 404 for the life of the page and retries a 5xx. Answering 404 for
// a download that merely failed turns one offline moment into a permanently silent kind.
//
// The routes are re-declared here rather than mounted from config-routes, which reads the
// developer's real ~/.mulmoterminal/config.json at import time. What is under test is the
// status decision, and it is the same expression.

function mountPresetRoute(app: express.Express, cacheDir: string, fetchImpl: typeof fetch) {
  app.get("/api/sound-preset/:id", async (req, res) => {
    const bytes = await readSoundPreset(req.params.id, { cacheDir, fetchImpl });
    if (bytes) return res.type("audio/mpeg").send(bytes);
    res.status(soundPresetById(req.params.id) ? 503 : 404).end();
  });
}

describe("preset route status", () => {
  let server: Server;
  let base: string;
  let dir: string;
  const offline = (async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  }) as unknown as typeof fetch;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "mt-preset-route-"));
    const app = express();
    mountPresetRoute(app, dir, offline);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers 503 for a known preset it could not download — the client must retry", async () => {
    const res = await fetch(`${base}/api/sound-preset/coin`);
    expect(res.status).toBe(503);
  });

  it("answers 404 for a preset that does not exist — nothing to retry", async () => {
    const res = await fetch(`${base}/api/sound-preset/nope`);
    expect(res.status).toBe(404);
  });

  it("serves the cached bytes when they are there", async () => {
    writeFileSync(path.join(dir, "sound_coin.mp3"), "cached");
    const res = await fetch(`${base}/api/sound-preset/coin`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("audio/mpeg");
    expect(await res.text()).toBe("cached");
  });

  it("caches under ~/.mulmoterminal/sounds by default", () => {
    expect(SOUNDS_DIR.endsWith(path.join(".mulmoterminal", "sounds"))).toBe(true);
  });
});
