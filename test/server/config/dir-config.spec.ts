// @vitest-environment node
import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { resolveDirSound, loadDirConfig, publicDirConfig, dirSoundFor, dirConfigDetail, MISSING_DIR_CONFIG_DETAIL } from "../../../server/config/dir-config";
import { existingWorkspace } from "../../../server/config/workspace";

const tmp = () => makeTempDir("mt-dircfg-");

function withConfig(body: unknown): { dir: string; cleanup: () => void } {
  const dir = tmp();
  writeFileSync(path.join(dir, ".mulmoterminal.json"), typeof body === "string" ? body : JSON.stringify(body));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("resolveDirSound", () => {
  it("resolves a relative file inside cwd and rejects escapes", () => {
    const parent = tmp();
    const dir = path.join(parent, "project");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "alert.mp3"), "x");
    writeFileSync(path.join(parent, "outside.mp3"), "x");
    symlinkSync(path.join(parent, "outside.mp3"), path.join(dir, "link.mp3"));

    expect(resolveDirSound(dir, "alert.mp3")).toBe(path.join(dir, "alert.mp3"));
    expect(resolveDirSound(dir, "../outside.mp3")).toBeNull();
    expect(resolveDirSound(dir, path.join(dir, "alert.mp3"))).toBeNull();
    expect(resolveDirSound(dir, "link.mp3")).toBeNull();
    rmSync(parent, { recursive: true, force: true });
  });
});

describe("loadDirConfig", () => {
  it("loads terminal/session-related directory settings and ignores removed skills", () => {
    const { dir, cleanup } = withConfig({
      name: "  PROD  ",
      badgeColor: "#CF222E",
      headerColor: "#190A23",
      fontSize: 17,
      fontFamily: "'Cica', monospace",
      orderPriority: 5,
      theme: "nord",
      sound: "./a.mp3",
      sounds: { waiting: "preset:gong" },
      buttons: [{ id: "files", label: "Files", run: "open", open: { files: "${dir}" } }],
      chips: ["git"],
      provider: "openrouter",
      model: "kimi-k2",
      addDirs: ["shared"],
      appendSystemPrompt: false,
      skills: ["review"],
    });
    mkdirSync(path.join(dir, "shared"));
    writeFileSync(path.join(dir, "a.mp3"), "x");
    expect(loadDirConfig(dir)).toMatchObject({
      name: "PROD",
      badgeColor: "#cf222e",
      headerColor: "#190a23",
      fontSize: 17,
      fontFamily: "'Cica', monospace",
      orderPriority: 5,
      theme: "nord",
      sound: path.join(dir, "a.mp3"),
      sounds: { waiting: { source: "preset", id: "gong" } },
      provider: "openrouter",
      model: "kimi-k2",
      addDirs: [path.join(dir, "shared")],
      appendSystemPrompt: false,
    });
    expect("skills" in loadDirConfig(dir)).toBe(false);
    cleanup();
  });

  it("returns empty config for absent, malformed, or unknown settings", () => {
    const dir = tmp();
    expect(loadDirConfig(dir)).toMatchObject({ name: null, theme: null, provider: null, model: null, addDirs: null });
    rmSync(dir, { recursive: true, force: true });

    const bad = withConfig("{ not json");
    expect(loadDirConfig(bad.dir)).toMatchObject({ name: null, theme: null, provider: null });
    bad.cleanup();
  });
});

describe("publicDirConfig / detail", () => {
  it("hides sound paths and reports non-cell extras separately", () => {
    const { dir, cleanup } = withConfig({
      name: "proj",
      sound: "a.mp3",
      provider: "openrouter",
      model: "kimi",
      buttons: [{ id: "files", label: "Files", run: "open", open: { files: "${dir}" } }],
      chips: ["git"],
      skills: ["old"],
    });
    writeFileSync(path.join(dir, "a.mp3"), "x");

    expect(publicDirConfig(dir)).toMatchObject({ name: "proj", hasSound: true });
    const detail = dirConfigDetail(dir);
    expect(detail.extras).toMatchObject({ provider: "openrouter", model: "kimi", buttonLabels: ["Files"], chipLabels: ["git"] });
    expect("skills" in detail.extras).toBe(false);
    cleanup();
  });

  it("reports a missing directory separately from an empty existing one", () => {
    const missing = path.join(tmp(), "gone");
    expect(existingWorkspace(missing)).toBeNull();
    expect(MISSING_DIR_CONFIG_DETAIL.exists).toBe(false);
  });
});

describe("dirSoundFor", () => {
  it("uses per-kind sound first, then the all-kind sound", () => {
    const { dir, cleanup } = withConfig({ sound: "all.mp3", sounds: { waiting: "preset:gong" } });
    writeFileSync(path.join(dir, "all.mp3"), "x");
    expect(dirSoundFor(dir, "waiting")).toEqual({ source: "preset", id: "gong" });
    expect(dirSoundFor(dir, "finished")).toEqual({ source: "file", path: path.join(dir, "all.mp3") });
    cleanup();
  });
});
