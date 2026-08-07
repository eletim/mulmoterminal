// @vitest-environment node
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import path from "node:path";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { makeTempDir } from "../../support/tempDir.js";
import { directoryListing, listDirectories, mountDirectoryPickerRoutes } from "../../../server/files/directories";

const tmp = () => makeTempDir("mt-dirs-");

describe("directory picker listing", () => {
  it("lists only directories, sorted alphabetically", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "zeta"));
    mkdirSync(path.join(dir, "alpha"));
    writeFileSync(path.join(dir, "notes.md"), "x");
    try {
      expect(listDirectories(dir)).toEqual([
        { name: "alpha", path: path.join(dir, "alpha") },
        { name: "zeta", path: path.join(dir, "zeta") },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps navigation inside the home root", () => {
    const home = tmp();
    const project = path.join(home, "project");
    mkdirSync(project);
    try {
      const listing = directoryListing(project, project, home);
      expect(listing?.path).toBe(project);
      expect(listing?.parent).toBe(home);

      const root = directoryListing(project, home, home);
      expect(root?.parent).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("also allows the configured workspace when it is outside home", () => {
    const home = tmp();
    const workspace = tmp();
    mkdirSync(path.join(workspace, "repo"));
    try {
      const listing = directoryListing(workspace, workspace, home);
      expect(listing?.path).toBe(workspace);
      expect(listing?.parent).toBeNull();
      expect(listing?.directories).toEqual([{ name: "repo", path: path.join(workspace, "repo") }]);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("refuses paths outside every browsable root", () => {
    const home = tmp();
    const outside = tmp();
    try {
      expect(directoryListing(home, outside, home)).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("refuses a symlink that escapes the browsable root", () => {
    const home = tmp();
    const outside = tmp();
    symlinkSync(outside, path.join(home, "outside-link"));
    try {
      expect(directoryListing(home, path.join(home, "outside-link"), home)).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("directory picker route", () => {
  it("serves directory listings and reports refused roots as 403", async () => {
    const home = tmp();
    const outside = tmp();
    mkdirSync(path.join(home, "repo"));
    const app = express();
    mountDirectoryPickerRoutes(app, { defaultCwd: home });
    try {
      const ok = await request(app).get(`/api/directories?path=${encodeURIComponent(path.join(home, "repo"))}`);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ path: path.join(home, "repo"), parent: home, directories: [] });

      const refused = await request(app).get(`/api/directories?path=${encodeURIComponent(outside)}`);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toContain("outside");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
