// @vitest-environment node
import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { currentVersion, listEntries, mdToHtmlDoc, mountFilesBrowseRoutes, MAX_EDIT_BYTES } from "../../../server/files/files-browse";

const tmp = () => makeTempDir("mt-files-");

describe("listEntries", () => {
  it("lists directories first, then files, each alphabetical, with sizes", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "zsub"));
    mkdirSync(path.join(dir, "asub"));
    writeFileSync(path.join(dir, "b.txt"), "hello");
    writeFileSync(path.join(dir, "a.md"), "# hi");
    const entries = listEntries(dir);
    expect(entries.map((e) => e.name)).toEqual(["asub", "zsub", "a.md", "b.txt"]);
    expect(entries.find((e) => e.name === "b.txt")).toMatchObject({ dir: false, size: 5 });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mdToHtmlDoc", () => {
  it("wraps body HTML into a self-contained document", () => {
    const doc = mdToHtmlDoc("<p>x</p>", "a<b>.md");
    expect(doc).toContain("<p>x</p>");
    expect(doc).toContain("<title>a&lt;b&gt;.md</title>");
    expect(doc).toContain("color-scheme:light dark");
    expect(doc).not.toContain("<script");
  });
});

describe("read-only browse routes", () => {
  const serve = (dir: string) => {
    const app = express();
    app.use(express.json());
    mountFilesBrowseRoutes(app, { defaultCwd: dir });
    return app;
  };
  const withProject = async (run: (app: express.Express, dir: string) => Promise<void>) => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.md"), "# one");
    writeFileSync(path.join(dir, "data.json"), JSON.stringify({ ok: true }));
    try {
      await run(serve(dir), dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const query = (dir: string, file = "a.md") => `cwd=${encodeURIComponent(dir)}&path=${encodeURIComponent(file)}`;

  it("serves directory listings, text, markdown preview, json, table, and version", async () => {
    await withProject(async (app, dir) => {
      expect((await request(app).get(`/api/files/browse/list?cwd=${encodeURIComponent(dir)}`)).body.entries.map((e: { name: string }) => e.name)).toContain(
        "a.md",
      );

      const text = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      expect(text.status).toBe(200);
      expect(text.body.text).toBe("# one");
      expect(typeof text.body.version).toBe("string");

      expect((await request(app).get(`/api/files/browse/md?${query(dir)}`)).text).toContain("<h1>one</h1>");
      expect((await request(app).get(`/api/files/browse/json?${query(dir, "data.json")}`)).text).toContain("&quot;ok&quot;: true");
      expect((await request(app).get(`/api/files/browse/table?${query(dir, "data.json")}`)).text).toContain("{&quot;ok&quot;:true}");
      expect((await request(app).get(`/api/files/browse/version?${query(dir)}`)).body).toEqual({ version: text.body.version });
    });
  });

  it("does not mount write or backup routes", async () => {
    await withProject(async (app, dir) => {
      expect(
        (
          await request(app)
            .put(`/api/files/browse/write?${query(dir)}`)
            .send({ text: "two" })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .put(`/api/files/browse/backup?${query(dir)}`)
            .send({ text: "two" })
        ).status,
      ).toBe(404);
    });
  });

  it("refuses to read or hash a file past the view cap", async () => {
    await withProject(async (app, dir) => {
      writeFileSync(path.join(dir, "a.md"), "x".repeat(MAX_EDIT_BYTES + 1));
      expect((await request(app).get(`/api/files/browse/text?${query(dir)}`)).status).toBe(413);
      expect((await request(app).get(`/api/files/browse/version?${query(dir)}`)).status).toBe(413);
    });
  });
});

describe("currentVersion", () => {
  it("reports null only for a missing path", () => {
    const dir = tmp();
    expect(currentVersion(path.join(dir, "nope.md"))).toBeNull();
    expect(() => currentVersion(dir)).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
