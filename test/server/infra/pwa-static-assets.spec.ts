// @vitest-environment node
// Pins the static-file half of the mobile PWA contract: Vite dev and the built Express app both
// rely on the same public assets, so the manifest must have the right content type and every
// declared install icon must be reachable.
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appRequest } from "../../helpers/appRequest.js";

const repoRoot = path.join(__dirname, "..", "..", "..");
const publicDir = path.join(repoRoot, "public");
const manifest = JSON.parse(readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf-8")) as {
  start_url?: string;
  display?: string;
  icons?: Array<{ src?: string; type?: string }>;
};

function staticRequest() {
  const app = express();
  app.use(express.static(publicDir));
  return appRequest(app);
}

describe("mobile PWA static assets", () => {
  it("serves the manifest with the web manifest content type", async () => {
    const res = await staticRequest()("/manifest.webmanifest");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    expect(await res.json()).toMatchObject({ start_url: "/mobile/terminals", display: "standalone" });
  });

  it("serves every declared icon without a 404", async () => {
    const request = staticRequest();

    for (const icon of manifest.icons ?? []) {
      const res = await request(icon.src ?? "");
      expect(res.status, icon.src).toBe(200);
      expect(res.headers.get("content-type"), icon.src).toContain(icon.type ?? "");
    }
  });
});
