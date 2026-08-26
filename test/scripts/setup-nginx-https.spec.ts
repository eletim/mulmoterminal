// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
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

function writeFakeTailscale(status = 0) {
  const binDir = path.join(currentTempDir(), "bin");
  const logFile = path.join(currentTempDir(), "tailscale.log");
  mkdirSync(binDir, { recursive: true });
  const executable = path.join(binDir, "tailscale");
  writeFileSync(
    executable,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> ${JSON.stringify(logFile)}`,
      'if [[ "$1" == "status" ]]; then',
      '  printf \'%s\\n\' \'{"Self":{"DNSName":"dev.tail.ts.net."}}\'',
      "  exit 0",
      "fi",
      `[[ ${status} == 0 ]] || exit ${status}`,
      "while [[ $# -gt 0 ]]; do",
      '  case "$1" in',
      '    --cert-file) cert_file="$2"; shift 2 ;;',
      '    --key-file) key_file="$2"; shift 2 ;;',
      "    *) shift ;;",
      "  esac",
      "done",
      'printf cert > "$cert_file"',
      'printf key > "$key_file"',
      "",
    ].join("\n"),
  );
  chmodSync(executable, 0o755);
  return { binDir, logFile };
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
    expect(log.match(/^-t$/gm)).toHaveLength(1);
    expect(log.match(/^-s reload$/gm)).toHaveLength(1);
    expect(second.stdout).toContain("nginx configuration is already current; test and reload skipped");
  });

  it("reports whether setup is needed without writing, testing, or reloading", () => {
    dir = makeTempDir("nginx-https-check-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx();
    const serverConf = path.join(currentTempDir(), "site.conf");
    writeFileSync(serverConf, ["server {", "    listen 443 ssl;", "    server_name dev.tail.ts.net;", "}"].join("\n"));
    const env = {
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_SERVER_CONF: serverConf,
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
    };

    const needed = runScript(env, ["--check"]);
    expect(needed.status).toBe(10);
    expect(readFileSync(serverConf, "utf8")).not.toContain("MulmoTerminal managed include");
    expect(existsSync(logFile)).toBe(false);

    expect(runScript(env).status).toBe(0);
    const current = runScript(env, ["--check"]);
    expect(current.status).toBe(0);
    expect(readFileSync(logFile, "utf8").match(/^-t$|^-s reload$/gm)).toHaveLength(2);
  });

  it("does not reload when nginx -t fails", () => {
    dir = makeTempDir("nginx-https-test-fail-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx(1);
    const serverConf = path.join(currentTempDir(), "site.conf");
    writeFileSync(serverConf, ["server {", "    listen 443 ssl;", "    server_name dev.tail.ts.net;", "}"].join("\n"));

    const env = {
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_SERVER_CONF: serverConf,
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
    };
    const result = runScript(env);
    const retried = runScript(env);
    const log = readFileSync(logFile, "utf8");

    expect(result.status).toBe(1);
    expect(retried.status).toBe(1);
    expect(result.stderr).toContain("nginx -t failed; nginx was not reloaded.");
    expect(log.match(/^-t$/gm)).toHaveLength(2);
    expect(log).not.toContain("-s reload");
    expect(existsSync(path.join(root, ".mulmoterminal-nginx-validated"))).toBe(false);
  });

  it("keeps reload pending after --no-reload", () => {
    dir = makeTempDir("nginx-https-no-reload-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx();
    const serverConf = path.join(currentTempDir(), "site.conf");
    writeFileSync(serverConf, ["server {", "    listen 443 ssl;", "    server_name dev.tail.ts.net;", "}"].join("\n"));
    const env = {
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_SERVER_CONF: serverConf,
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
    };

    const withoutReload = runScript(env, ["--no-reload"]);
    expect(withoutReload.status).toBe(0);
    expect(existsSync(path.join(root, ".mulmoterminal-nginx-validated"))).toBe(false);

    const nextStartup = runScript(env);
    expect(nextStartup.status).toBe(0);
    expect(readFileSync(logFile, "utf8").trim().split("\n")).toEqual(["-t", "-t", "-s reload"]);
    expect(existsSync(path.join(root, ".mulmoterminal-nginx-validated"))).toBe(true);
  });

  it("auto-discovers an exact server_name in the same TLS server block", () => {
    dir = makeTempDir("nginx-https-discovery-");
    const root = nginxRoot();
    const { executable } = writeFakeNginx();
    const enabledDir = path.join(root, "sites-enabled");
    const availableDir = path.join(root, "sites-available");
    mkdirSync(enabledDir, { recursive: true });
    mkdirSync(availableDir, { recursive: true });
    const misleading = path.join(enabledDir, "aaa-misleading.conf");
    const correct = path.join(availableDir, "zzz-correct.conf");
    const enabledCorrect = path.join(enabledDir, "zzz-correct.conf");
    writeFileSync(misleading, ["server { listen 443 ssl; server_name notdev.tail.ts.net; }", "server { listen 80; server_name dev.tail.ts.net; }"].join("\n"));
    writeFileSync(correct, ["server {", "    listen 443 ssl;", "    server_name dev.tail.ts.net;", "}"].join("\n"));
    symlinkSync(correct, enabledCorrect);

    const result = runScript({
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nginx HTTPS mode existing");
    expect(readFileSync(misleading, "utf8")).not.toContain("MulmoTerminal managed include");
    expect(readFileSync(correct, "utf8")).toContain("MulmoTerminal managed include");
  });

  it("selects new mode when existing HTTPS servers do not match the target host", () => {
    dir = makeTempDir("nginx-https-auto-new-");
    const root = nginxRoot();
    const { executable } = writeFakeNginx();
    const availableDir = path.join(root, "sites-available");
    const enabledDir = path.join(root, "sites-enabled");
    const unrelated = path.join(enabledDir, "localhost.conf");
    const certFile = path.join(currentTempDir(), "dev.tail.ts.net.crt");
    const keyFile = path.join(currentTempDir(), "dev.tail.ts.net.key");
    mkdirSync(enabledDir, { recursive: true });
    writeFileSync(unrelated, ["server {", "    listen 443 ssl;", "    server_name localhost;", "}"].join("\n"));
    writeFileSync(certFile, "cert");
    writeFileSync(keyFile, "key");

    const result = runScript({
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      MULMOTERMINAL_NGINX_CERT_FILE: certFile,
      MULMOTERMINAL_NGINX_KEY_FILE: keyFile,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nginx HTTPS mode new");
    expect(readFileSync(unrelated, "utf8")).not.toContain("MulmoTerminal");
    expect(readFileSync(path.join(availableDir, "mulmoterminal.conf"), "utf8")).toContain("server_name dev.tail.ts.net;");
  });

  it("honors explicit existing mode even when no matching HTTPS server is found", () => {
    dir = makeTempDir("nginx-https-explicit-existing-");
    const root = nginxRoot();
    const enabledDir = path.join(root, "sites-enabled");
    const unrelated = path.join(enabledDir, "localhost.conf");
    mkdirSync(enabledDir, { recursive: true });
    writeFileSync(unrelated, ["server {", "    listen 443 ssl;", "    server_name localhost;", "}"].join("\n"));

    const result = runScript({
      MULMOTERMINAL_NGINX_DRY_RUN: "1",
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_MODE: "existing",
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("nginx HTTPS mode existing");
    expect(result.stderr).toContain("--server-conf is required in existing mode");
    expect(readFileSync(unrelated, "utf8")).not.toContain("MulmoTerminal");
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

  it("keeps an auto-detected managed server in new mode on later runs", () => {
    dir = makeTempDir("nginx-https-auto-managed-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx();
    const certFile = path.join(currentTempDir(), "dev.tail.ts.net.crt");
    const keyFile = path.join(currentTempDir(), "dev.tail.ts.net.key");
    writeFileSync(certFile, "cert");
    writeFileSync(keyFile, "key");
    const commonEnv = {
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      MULMOTERMINAL_NGINX_CERT_FILE: certFile,
      MULMOTERMINAL_NGINX_KEY_FILE: keyFile,
    };

    expect(runScript({ ...commonEnv, MULMOTERMINAL_NGINX_MODE: "new" }).status).toBe(0);
    const automatic = runScript(commonEnv);
    const serverFile = path.join(root, "sites-available", "mulmoterminal.conf");

    expect(automatic.status).toBe(0);
    expect(automatic.stdout).toContain("nginx HTTPS mode new");
    expect(readFileSync(serverFile, "utf8")).not.toContain("BEGIN MulmoTerminal managed include");
    expect(readFileSync(logFile, "utf8").trim().split("\n")).toEqual(["-t", "-s reload"]);
  });

  it("reloads a managed new server after its certificate is renewed", () => {
    dir = makeTempDir("nginx-https-renewed-cert-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx();
    const certFile = path.join(currentTempDir(), "dev.tail.ts.net.crt");
    const keyFile = path.join(currentTempDir(), "dev.tail.ts.net.key");
    writeFileSync(certFile, "cert");
    writeFileSync(keyFile, "key");
    const env = {
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_MODE: "new",
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      MULMOTERMINAL_NGINX_CERT_FILE: certFile,
      MULMOTERMINAL_NGINX_KEY_FILE: keyFile,
    };

    expect(runScript(env).status).toBe(0);
    const renewedAt = new Date(Date.now() + 60_000);
    utimesSync(certFile, renewedAt, renewedAt);

    expect(runScript(env, ["--check"]).status).toBe(10);
    expect(runScript(env).status).toBe(0);
    expect(readFileSync(logFile, "utf8").trim().split("\n")).toEqual(["-t", "-s reload", "-t", "-s reload"]);
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

  it("automatically creates a missing Tailscale certificate and completes new-mode setup", () => {
    dir = makeTempDir("nginx-https-auto-cert-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx();
    const tailscale = writeFakeTailscale();
    const certFile = path.join(currentTempDir(), "certs", "dev.tail.ts.net.crt");
    const keyFile = path.join(currentTempDir(), "certs", "dev.tail.ts.net.key");

    const env = {
      PATH: `${tailscale.binDir}:/usr/bin:/bin`,
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_MODE: "new",
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      MULMOTERMINAL_NGINX_CERT_FILE: certFile,
      MULMOTERMINAL_NGINX_KEY_FILE: keyFile,
    };
    const result = runScript(env);
    const second = runScript(env);

    expect(result.status).toBe(0);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("nginx configuration is already current; test and reload skipped");
    expect(result.stdout).toContain("requesting a Tailscale HTTPS certificate");
    expect(readFileSync(certFile, "utf8")).toBe("cert");
    expect(readFileSync(keyFile, "utf8")).toBe("key");
    expect(readFileSync(tailscale.logFile, "utf8")).toContain(`cert --cert-file ${certFile} --key-file ${keyFile} dev.tail.ts.net`);
    expect(readFileSync(tailscale.logFile, "utf8").match(/^cert /gm)).toHaveLength(1);
    expect(readFileSync(logFile, "utf8").trim().split("\n")).toEqual(["-t", "-s reload"]);
  });

  it("does not request a Tailscale certificate when both certificate files already exist", () => {
    dir = makeTempDir("nginx-https-existing-cert-");
    const root = nginxRoot();
    const { executable } = writeFakeNginx();
    const tailscale = writeFakeTailscale();
    const certFile = path.join(currentTempDir(), "dev.tail.ts.net.crt");
    const keyFile = path.join(currentTempDir(), "dev.tail.ts.net.key");
    writeFileSync(certFile, "cert");
    writeFileSync(keyFile, "key");

    const result = runScript({
      PATH: `${tailscale.binDir}:/usr/bin:/bin`,
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_MODE: "new",
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      MULMOTERMINAL_NGINX_CERT_FILE: certFile,
      MULMOTERMINAL_NGINX_KEY_FILE: keyFile,
    });

    expect(result.status).toBe(0);
    expect(existsSync(tailscale.logFile)).toBe(false);
  });

  it("stops with admin-console guidance when tailscale cert fails", () => {
    dir = makeTempDir("nginx-https-cert-fail-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx();
    const tailscale = writeFakeTailscale(1);

    const result = runScript({
      PATH: `${tailscale.binDir}:/usr/bin:/bin`,
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_MODE: "new",
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      MULMOTERMINAL_NGINX_CERT_FILE: path.join(currentTempDir(), "certs", "dev.tail.ts.net.crt"),
      MULMOTERMINAL_NGINX_KEY_FILE: path.join(currentTempDir(), "certs", "dev.tail.ts.net.key"),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Enable HTTPS certificates for this tailnet in the Tailscale admin console");
    expect(result.stderr).toContain("rerun ./scripts/start-dev.sh");
    expect(result.stderr).not.toContain("sudo tailscale cert");
    expect(existsSync(logFile)).toBe(false);
  });

  it("continues new-mode setup when only managed map and location files remain from a previous attempt", () => {
    dir = makeTempDir("nginx-https-partial-retry-");
    const root = nginxRoot();
    const { executable, logFile } = writeFakeNginx();
    const tailscale = writeFakeTailscale();
    const certFile = path.join(currentTempDir(), "certs", "dev.tail.ts.net.crt");
    const keyFile = path.join(currentTempDir(), "certs", "dev.tail.ts.net.key");
    mkdirSync(path.join(root, "conf.d"), { recursive: true });
    mkdirSync(path.join(root, "snippets"), { recursive: true });
    writeFileSync(path.join(root, "conf.d", "mulmoterminal-websocket-map.conf"), "stale map\n");
    writeFileSync(path.join(root, "snippets", "mulmoterminal-location.conf"), "stale location\n");

    const result = runScript({
      PATH: `${tailscale.binDir}:/usr/bin:/bin`,
      MULMOTERMINAL_NGINX_BIN: executable,
      MULMOTERMINAL_NGINX_ROOT: root,
      MULMOTERMINAL_NGINX_SERVER_NAME: "dev.tail.ts.net",
      MULMOTERMINAL_NGINX_CERT_FILE: certFile,
      MULMOTERMINAL_NGINX_KEY_FILE: keyFile,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(root, "conf.d", "mulmoterminal-websocket-map.conf"), "utf8")).toContain("map $http_upgrade");
    expect(readFileSync(path.join(root, "snippets", "mulmoterminal-location.conf"), "utf8")).toContain("proxy_pass");
    expect(readFileSync(path.join(root, "sites-available", "mulmoterminal.conf"), "utf8")).toContain("server_name dev.tail.ts.net;");
    expect(readFileSync(logFile, "utf8").trim().split("\n")).toEqual(["-t", "-s reload"]);
  });
});
