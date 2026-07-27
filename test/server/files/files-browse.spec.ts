import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { listEntries, mdToHtmlDoc, mountFilesBrowseRoutes } from "../../../server/files/files-browse";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-files-"));

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
    expect(entries.find((e) => e.name === "asub")).toMatchObject({ dir: true });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mdToHtmlDoc", () => {
  it("wraps body HTML and escapes the title", () => {
    const doc = mdToHtmlDoc("<p>x</p>", "a<b>.md");
    expect(doc).toContain("<p>x</p>");
    expect(doc).toContain("<title>a&lt;b&gt;.md</title>");
    expect(doc.startsWith("<!doctype html>")).toBe(true);
  });

  // The page opens in its own tab under a sandbox CSP, so it cannot ask the app which theme
  // is on — it has to follow the reader's system setting instead of flashing white (#808).
  it("follows the reader's colour scheme", () => {
    const doc = mdToHtmlDoc("<p>x</p>", "a.md");
    expect(doc).toContain("color-scheme:light dark");
    expect(doc).toContain("@media(prefers-color-scheme:dark)");
  });

  // Everything is inlined on purpose: a sandboxed document fetching a stylesheet or a font
  // would be a request the CSP has to allow, for styling that has to work offline anyway.
  it("stays self-contained — no external stylesheet, script or font", () => {
    const doc = mdToHtmlDoc("<p>x</p>", "a.md");
    expect(doc).not.toContain("<link");
    expect(doc).not.toContain("<script");
    expect(doc).not.toMatch(/https?:\/\//);
  });
});

// The editor's write is conditional: the agent working in this very directory edits the same
// files, so a save has to be able to lose the race rather than silently win it.
describe("conditional write", () => {
  const serve = (dir: string) => {
    const app = express();
    app.use(express.json());
    mountFilesBrowseRoutes(app, { defaultCwd: dir });
    return app;
  };
  const withProject = async (run: (app: express.Express, dir: string) => Promise<void>) => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.md"), "one");
    try {
      await run(serve(dir), dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const query = (dir: string, file = "a.md") => `cwd=${encodeURIComponent(dir)}&path=${encodeURIComponent(file)}`;

  it("hands the editor a version with the text", async () => {
    await withProject(async (app, dir) => {
      const res = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      expect(res.status).toBe(200);
      expect(res.body.text).toBe("one");
      expect(typeof res.body.version).toBe("string");
    });
  });

  it("writes when the base version still matches, and reports the new one", async () => {
    await withProject(async (app, dir) => {
      const { body: read } = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      const res = await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "two", baseVersion: read.version });
      expect(res.status).toBe(200);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("two");
      // The response's version is the one to save against next, without re-reading.
      expect(res.body.version).not.toBe(read.version);
      const { body: reread } = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      expect(reread.version).toBe(res.body.version);
    });
  });

  it("refuses with 409 — and writes nothing — when the file moved on", async () => {
    await withProject(async (app, dir) => {
      const { body: read } = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      writeFileSync(path.join(dir, "a.md"), "the agent's version");

      const res = await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "my edit", baseVersion: read.version });
      expect(res.status).toBe(409);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("the agent's version");

      // The 409 carries the version now on disk, so a deliberate overwrite is one retry away.
      const forced = await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "my edit", baseVersion: res.body.version });
      expect(forced.status).toBe(200);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("my edit");
    });
  });

  it("treats a same-content rewrite as no conflict", async () => {
    await withProject(async (app, dir) => {
      const { body: read } = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      writeFileSync(path.join(dir, "a.md"), "one"); // changed and changed back
      const res = await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "two", baseVersion: read.version });
      expect(res.status).toBe(200);
    });
  });

  it("rejects a write with no baseVersion at all — there is no blind-write escape hatch", async () => {
    await withProject(async (app, dir) => {
      const res = await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "two" });
      expect(res.status).toBe(400);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("one");
    });
  });

  it("creates a new file when baseVersion is null, and 409s if something got there first", async () => {
    await withProject(async (app, dir) => {
      const created = await request(app)
        .put(`/api/files/browse/write?${query(dir, "new.md")}`)
        .send({ text: "fresh", baseVersion: null });
      expect(created.status).toBe(200);
      expect(readFileSync(path.join(dir, "new.md"), "utf8")).toBe("fresh");

      const again = await request(app)
        .put(`/api/files/browse/write?${query(dir, "new.md")}`)
        .send({ text: "clobber", baseVersion: null });
      expect(again.status).toBe(409);
      expect(readFileSync(path.join(dir, "new.md"), "utf8")).toBe("fresh");
    });
  });
});
