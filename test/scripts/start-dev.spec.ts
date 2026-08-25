// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../support/tempDir.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "start-dev.sh");
const BASH = "/usr/bin/bash";
let dir: string | null = null;

afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: process.env.HOME, MULMOTERMINAL_ENV_FILES: "/dev/null", ...extra };
}

function run(extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(BASH, [SCRIPT], { cwd: ROOT, env: cleanEnv(extra), encoding: "utf8" });
}

function executable(file: string, body: string) {
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
}

describe("start-dev.sh", () => {
  it("has valid bash syntax", () => {
    expect(spawnSync(BASH, ["-n", SCRIPT], { encoding: "utf8" }).status).toBe(0);
  });

  it("uses nginx by default and performs a non-mutating setup dry run", () => {
    dir = makeTempDir("start-dev-nginx-dry-");
    const result = run({
      MULMOTERMINAL_START_DRY_RUN: "1",
      MULMOTERMINAL_NGINX_ROOT: path.join(dir, "nginx"),
      MULMOTERMINAL_NGINX_SERVER_CONF: path.join(dir, "site.conf"),
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.example.test",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nginx HTTPS mode existing");
    expect(result.stdout).toContain("startup mode nginx");
    expect(result.stdout).toContain("would run: nginx -t");
  });

  it("starts local-only without invoking nginx or Tailscale", () => {
    const result = run({ MULMOTERMINAL_MODE: "local-only", MULMOTERMINAL_START_DRY_RUN: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("startup mode local-only");
    expect(result.stdout).not.toContain("nginx HTTPS mode");
    expect(result.stdout).not.toContain("tailscale serve");
  });

  it("treats the new tailscale-serve mode as required HTTPS Serve", () => {
    dir = makeTempDir("start-dev-no-tailscale-");
    const binDir = path.join(dir, "bin");
    mkdirSync(binDir);
    symlinkSync("/usr/bin/dirname", path.join(binDir, "dirname"));
    const result = run({ PATH: binDir, MULMOTERMINAL_MODE: "tailscale-serve" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tailscale CLI not found");
    expect(result.stderr).toContain("Tailscale Serve could not be configured");
    expect(result.stderr).not.toContain("fall back");
  });

  it("gives the shell precedence over user and repo env files", () => {
    dir = makeTempDir("start-dev-env-");
    const userEnv = path.join(dir, "user.env");
    const repoEnv = path.join(dir, "repo.env");
    writeFileSync(userEnv, "MULMOTERMINAL_MODE=tailscale-serve\n");
    writeFileSync(repoEnv, "MULMOTERMINAL_MODE=nginx\n");

    const result = run({
      MULMOTERMINAL_MODE: "local-only",
      MULMOTERMINAL_ENV_FILES: `${userEnv}:${repoEnv}`,
      MULMOTERMINAL_START_DRY_RUN: "1",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("startup mode local-only");
  });

  it("sets up changed nginx config once and skips test/reload on the next startup", () => {
    dir = makeTempDir("start-dev-nginx-");
    const binDir = path.join(dir, "bin");
    const nginxRoot = path.join(dir, "nginx");
    const serverConf = path.join(dir, "site.conf");
    const nginxLog = path.join(dir, "nginx.log");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(serverConf, ["server {", "    listen 443 ssl;", "    server_name dev.example.test;", "}"].join("\n"));
    executable(path.join(binDir, "nginx"), `printf '%s\\n' "$*" >> ${JSON.stringify(nginxLog)}`);
    executable(path.join(binDir, "yarn"), "exit 0");
    const env = {
      PATH: `${binDir}:/usr/bin:/bin`,
      MULMOTERMINAL_MODE: "nginx",
      MULMOTERMINAL_NGINX_BIN: path.join(binDir, "nginx"),
      MULMOTERMINAL_NGINX_ROOT: nginxRoot,
      MULMOTERMINAL_NGINX_SERVER_CONF: serverConf,
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.example.test",
    };

    const first = run(env);
    const second = run(env);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("nginx configuration is already current");
    expect(readFileSync(nginxLog, "utf8").trim().split("\n")).toEqual(["-t", "-s reload"]);
  });

  it("allows the nginx hostname loaded from the shared env in Vite", () => {
    dir = makeTempDir("start-dev-nginx-shared-env-");
    const binDir = path.join(dir, "bin");
    const nginxRoot = path.join(dir, "nginx");
    const serverConf = path.join(dir, "site.conf");
    const sharedEnv = path.join(dir, "local.env");
    const allowedHostLog = path.join(dir, "allowed-host.log");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(serverConf, ["server {", "    listen 443 ssl;", "    server_name custom.example.test;", "}"].join("\n"));
    executable(path.join(binDir, "nginx"), "exit 0");
    executable(path.join(binDir, "yarn"), `printf '%s\\n' "\${__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}" > ${JSON.stringify(allowedHostLog)}`);
    writeFileSync(
      sharedEnv,
      [
        "MULMOTERMINAL_MODE=nginx",
        `MULMOTERMINAL_NGINX_ROOT=${nginxRoot}`,
        `MULMOTERMINAL_NGINX_SERVER_CONF=${serverConf}`,
        `MULMOTERMINAL_NGINX_BIN=${path.join(binDir, "nginx")}`,
        "MULMOTERMINAL_NGINX_SERVER_NAME=custom.example.test",
        "MULMOTERMINAL_ALLOWED_ORIGINS=https://custom.example.test",
      ].join("\n"),
    );

    const result = run({ PATH: `${binDir}:/usr/bin:/bin`, MULMOTERMINAL_ENV_FILES: sharedEnv });
    expect(result.status).toBe(0);
    expect(readFileSync(allowedHostLog, "utf8").trim()).toBe("custom.example.test");
  });
});
