// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../support/tempDir.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "start-tailscale-dev.sh");
const BASH = "/usr/bin/bash";

let dir: string | null = null;

afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: process.env.HOME, ...extra };
}

function dryRun(extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(BASH, [SCRIPT], {
    cwd: ROOT,
    env: cleanEnv({ MULMOTERMINAL_START_DRY_RUN: "1", MULMOTERMINAL_ENV_FILES: "", ...extra }),
    encoding: "utf8",
  });
}

describe("start-tailscale-dev.sh", () => {
  it("has valid bash syntax", () => {
    const result = spawnSync(BASH, ["-n", SCRIPT], { cwd: ROOT, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("starts the issue #59 target ports, base path, mobile mode, and Tailscale route by default", () => {
    const result = dryRun();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tailscale serve --bg --set-path=/mulmoterminal http://localhost:6857/mulmoterminal");
    expect(result.stdout).toContain("PORT=34568 CLIENT_PORT=6857 MULMOTERMINAL_BASE_PATH=/mulmoterminal/ MULMOTERMINAL_MOBILE_MODE=local yarn dev");
  });

  it("loads ignored env files without overriding pre-existing shell variables", () => {
    dir = makeTempDir("tailscale-dev-env-");
    const envFile = path.join(dir, ".env");
    const localEnvFile = path.join(dir, ".env.local");
    writeFileSync(envFile, "PORT=11111\nCLIENT_PORT=22222\nMULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY=secret-from-env\n");
    writeFileSync(localEnvFile, "PORT=33333\nMULMOTERMINAL_BASE_PATH=custom\n");

    const result = dryRun({
      CLIENT_PORT: "44444",
      MULMOTERMINAL_ENV_FILES: `${envFile}:${localEnvFile}`,
      MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY: "secret-from-shell",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tailscale serve --bg --set-path=/custom http://localhost:44444/custom");
    expect(result.stdout).toContain("PORT=33333 CLIENT_PORT=44444 MULMOTERMINAL_BASE_PATH=/custom/");
    expect(result.stdout).not.toContain("secret-from-env");
    expect(result.stdout).not.toContain("secret-from-shell");
  });

  it("can skip Tailscale route setup", () => {
    const result = dryRun({ MULMOTERMINAL_TAILSCALE_SERVE: "0" });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("tailscale serve");
    expect(result.stdout).toContain("yarn dev");
  });
});
