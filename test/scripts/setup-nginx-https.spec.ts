// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../support/tempDir.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "setup-nginx-https.sh");
const BASH = "/usr/bin/bash";

let dir: string | null = null;

afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function currentTempDir() {
  if (!dir) throw new Error("test temp dir was not initialized");
  return dir;
}

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: process.env.HOME, ...extra };
}

function runScript(extra: NodeJS.ProcessEnv = {}, args: string[] = []) {
  return spawnSync(BASH, [SCRIPT, ...args], {
    cwd: ROOT,
    env: cleanEnv(extra),
    encoding: "utf8",
  });
}

function writeFakeNginx(status = 0) {
  const binDir = path.join(currentTempDir(), "bin");
  const logFile = path.join(currentTempDir(), "nginx.log");
  mkdirSync(binDir, { recursive: true });
  const executable = path.join(binDir, "nginx");
  writeFileSync(
    executable,
    ["#!/usr/bin/env bash", `printf '%s\\n' "$*" >> ${JSON.stringify(logFile)}`, 'if [[ "$1" == "-t" ]]; then', `  exit ${status}`, "fi", "exit 0", ""].join(
      "\n",
    ),
  );
  chmodSync(executable, 0o755);
  return { executable, logFile };
}

function nginxRoot() {
  const root = path.join(currentTempDir(), "nginx");
  mkdirSync(root, { recursive: true });
  return root;
}

describe("setup-nginx-https.sh", () => {
  it("has valid bash syntax", () => {
    const result = spawnSync(BASH, ["-n", SCRIPT], { cwd: ROOT, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("prints existing-server config in dry-run mode without requiring nginx", () => {
    dir = makeTempDir("nginx-https-dry-");
    const result = runScript(
      {
        MULMOTERMINAL_NGINX_DRY_RUN: "1",
        MULMOTERMINAL_NGINX_ROOT: nginxRoot(),
        MULMOTERMINAL_NGINX_SERVER_CONF: path.join(currentTempDir(), "existing.conf"),
        MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      },
      ["--base-path", "/mt/"],
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("location = /mt");
    expect(result.stdout).toContain("location /mt/");
    expect(result.stdout).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(result.stdout).toContain("proxy_set_header Connection $mulmoterminal_connection_upgrade;");
    expect(result.stdout).toContain("proxy_pass http://127.0.0.1:6857/mt/;");
    expect(result.stdout).toContain("would run: nginx -t");
  });

  it("adds a managed include to an existing TLS server once and reloads after nginx -t passes", () => {
    dir = makeTempDir("nginx-https-existing-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx();
    const serverConf = path.join(currentTempDir(), "site.conf");
    writeFileSync(
      serverConf,
      [
        "server {",
        "    listen 443 ssl;",
        "    server_name dev.tail.ts.net;",
        "    ssl_certificate /keep/fullchain.pem;",
        "    ssl_certificate_key /keep/privkey.pem;",
        "    location /health {",
        "        return 200;",
        "    }",
        "}",
        "",
        "server {",
        "    listen 80;",
        "    server_name dev.tail.ts.net;",
        "    return 301 https://$host$request_uri;",
        "}",
      ].join("\n"),
    );

    const env = {
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_SERVER_CONF: serverConf,
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
    };
    const first = runScript(env);
    const second = runScript(env);
    const updated = readFileSync(serverConf, "utf8");
    const log = readFileSync(logFile, "utf8");

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(updated.match(/BEGIN MulmoTerminal managed include/g)).toHaveLength(1);
    expect(updated).toContain(`include ${path.join(root, "snippets", "mulmoterminal-location.conf")};`);
    expect(updated).toContain("ssl_certificate /keep/fullchain.pem;");
    expect(updated.indexOf("BEGIN MulmoTerminal managed include")).toBeLessThan(updated.indexOf("server {\n    listen 80;"));
    expect(readdirSync(currentTempDir()).some((entry) => entry.startsWith("site.conf.bak."))).toBe(true);
    expect(log.match(/^-t$/gm)).toHaveLength(2);
    expect(log.match(/^-s reload$/gm)).toHaveLength(2);
  });

  it("does not reload when nginx -t fails", () => {
    dir = makeTempDir("nginx-https-test-fail-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx(1);
    const serverConf = path.join(currentTempDir(), "site.conf");
    writeFileSync(serverConf, ["server {", "    listen 443 ssl;", "    server_name dev.tail.ts.net;", "}"].join("\n"));

    const result = runScript({
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_SERVER_CONF: serverConf,
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
    });
    const log = readFileSync(logFile, "utf8");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("nginx -t failed; nginx was not reloaded.");
    expect(log).toContain("-t\n");
    expect(log).not.toContain("-s reload");
  });

  it("creates a new HTTPS server config with certificate paths and a base-path proxy", () => {
    dir = makeTempDir("nginx-https-new-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx();
    const certFile = path.join(currentTempDir(), "dev.tail.ts.net.crt");
    const keyFile = path.join(currentTempDir(), "dev.tail.ts.net.key");
    writeFileSync(certFile, "cert");
    writeFileSync(keyFile, "key");

    const result = runScript({
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_MODE: "new",
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      MULMOTERMINAL_NGINX_CERT_FILE: certFile,
      MULMOTERMINAL_NGINX_KEY_FILE: keyFile,
      MULMOTERMINAL_NGINX_BASE_PATH: "/mt/",
      CLIENT_PORT: "7123",
    });
    const serverFile = path.join(root, "sites-available", "mulmoterminal.conf");
    const enabledFile = path.join(root, "sites-enabled", "mulmoterminal.conf");
    const server = readFileSync(serverFile, "utf8");
    const location = readFileSync(path.join(root, "snippets", "mulmoterminal-location.conf"), "utf8");
    const map = readFileSync(path.join(root, "conf.d", "mulmoterminal-websocket-map.conf"), "utf8");
    const log = readFileSync(logFile, "utf8");

    expect(result.status).toBe(0);
    expect(server).toContain("listen 443 ssl http2;");
    expect(server).toContain("server_name dev.tail.ts.net;");
    expect(server).toContain(`ssl_certificate ${certFile};`);
    expect(server).toContain(`ssl_certificate_key ${keyFile};`);
    expect(location).toContain("location = /mt");
    expect(location).toContain("location /mt/");
    expect(location).toContain("proxy_pass http://127.0.0.1:7123/mt/;");
    expect(map).toContain("map $http_upgrade $mulmoterminal_connection_upgrade");
    expect(existsSync(enabledFile)).toBe(true);
    expect(readFileSync(enabledFile, "utf8")).toBe(server);
    expect(log).toContain("-t\n");
    expect(log).toContain("-s reload\n");
  });

  it("omits the exact-path redirect for root base path", () => {
    dir = makeTempDir("nginx-https-root-path-");
    const root = nginxRoot();
    const result = runScript({
      MULMOTERMINAL_NGINX_DRY_RUN: "1",
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_SERVER_CONF: path.join(currentTempDir(), "existing.conf"),
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      MULMOTERMINAL_NGINX_BASE_PATH: "/",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("location = /");
    expect(result.stdout).toContain("location / {");
    expect(result.stdout).toContain("proxy_pass http://127.0.0.1:6857/;");
  });

  it("keeps a custom upstream exactly as the operator wrote it", () => {
    dir = makeTempDir("nginx-https-custom-upstream-");
    const root = nginxRoot();
    const result = runScript({
      MULMOTERMINAL_NGINX_DRY_RUN: "1",
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_SERVER_CONF: path.join(currentTempDir(), "existing.conf"),
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      MULMOTERMINAL_NGINX_BASE_PATH: "/mulmoterminal/",
      MULMOTERMINAL_NGINX_UPSTREAM: "http://127.0.0.1:34567",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("proxy_pass http://127.0.0.1:34567;");
    expect(result.stdout).not.toContain("proxy_pass http://127.0.0.1:34567/;");
  });

  it("fails new mode before nginx -t when certificate files are missing", () => {
    dir = makeTempDir("nginx-https-missing-cert-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx();

    const result = runScript({
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_MODE: "new",
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      MULMOTERMINAL_NGINX_CERT_FILE: path.join(currentTempDir(), "missing.crt"),
      MULMOTERMINAL_NGINX_KEY_FILE: path.join(currentTempDir(), "missing.key"),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TLS certificate files are missing");
    expect(result.stderr).toContain("tailscale cert");
    expect(existsSync(logFile)).toBe(false);
  });
});
