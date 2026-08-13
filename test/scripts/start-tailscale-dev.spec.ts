// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function interactiveDryRun(input: string, extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(BASH, [SCRIPT], {
    cwd: ROOT,
    env: cleanEnv({ MULMOTERMINAL_START_DRY_RUN: "1", MULMOTERMINAL_START_FORCE_INTERACTIVE: "1", ...extra }),
    input,
    encoding: "utf8",
  });
}

function isolatedHome() {
  dir = makeTempDir("tailscale-dev-home-");
  return {
    HOME: dir,
    XDG_CONFIG_HOME: path.join(dir, ".config"),
  };
}

function currentTempDir() {
  if (!dir) throw new Error("test temp dir was not initialized");
  return dir;
}

function localEnvPath(homeEnv: NodeJS.ProcessEnv) {
  return path.join(String(homeEnv.XDG_CONFIG_HOME), "mulmoterminal", "local.env");
}

function prependPath(...entries: string[]) {
  return [...entries, path.dirname(process.execPath), "/usr/bin", "/bin"].join(":");
}

function writeFakeTailscale(binDir: string, body: string) {
  mkdirSync(binDir, { recursive: true });
  const executable = path.join(binDir, "tailscale");
  writeFileSync(executable, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(executable, 0o755);
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

  it("creates a shared local env with the detected Tailscale DNS name as the default", () => {
    const home = isolatedHome();
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(binDir, '[[ "$1 $2" == "status --json" ]] || exit 1\nprintf \'{"Self":{"DNSName":"e-ryzen.tail6bc726.ts.net."}}\\n\'');

    const result = interactiveDryRun("\nn\n", { ...home, PATH: prependPath(binDir) });
    const generated = readFileSync(localEnvPath(home), "utf8");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(".env.local and");
    expect(result.stdout).toContain("Detected Tailscale host:");
    expect(result.stdout).toContain("e-ryzen.tail6bc726.ts.net");
    expect(generated).toContain("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=e-ryzen.tail6bc726.ts.net");
    expect(generated).toContain("MULMOTERMINAL_ALLOWED_ORIGINS=https://e-ryzen.tail6bc726.ts.net");
  });

  it("allows manual host entry when the detected Tailscale DNS name is rejected", () => {
    const home = isolatedHome();
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(binDir, '[[ "$1 $2" == "status --json" ]] || exit 1\nprintf \'{"Self":{"DNSName":"detected.tail.ts.net"}}\\n\'');

    const result = interactiveDryRun("n\nmanual.tail.ts.net\nn\n", { ...home, PATH: prependPath(binDir) });
    const generated = readFileSync(localEnvPath(home), "utf8");

    expect(result.status).toBe(0);
    expect(generated).toContain("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=manual.tail.ts.net");
    expect(generated).toContain("MULMOTERMINAL_ALLOWED_ORIGINS=https://manual.tail.ts.net");
    expect(generated).not.toContain("detected.tail.ts.net");
  });

  it("falls back to manual host entry when Tailscale DNS detection fails", () => {
    const home = isolatedHome();
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(binDir, "exit 1");

    const result = interactiveDryRun("manual.tail.ts.net\nn\n", { ...home, PATH: prependPath(binDir) });
    const generated = readFileSync(localEnvPath(home), "utf8");

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Could not read Tailscale status");
    expect(result.stdout).not.toContain("Detected Tailscale host:");
    expect(generated).toContain("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=manual.tail.ts.net");
    expect(generated).toContain("MULMOTERMINAL_ALLOWED_ORIGINS=https://manual.tail.ts.net");
  });

  it("keeps manual host validation messages out of generated env values", () => {
    const home = isolatedHome();
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(binDir, "exit 1");

    const result = interactiveDryRun("\nmanual.tail.ts.net\nn\n", { ...home, PATH: prependPath(binDir) });
    const generated = readFileSync(localEnvPath(home), "utf8");

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("A value is required.");
    expect(generated).toContain("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=manual.tail.ts.net");
    expect(generated).toContain("MULMOTERMINAL_ALLOWED_ORIGINS=https://manual.tail.ts.net");
    expect(generated).not.toContain("A value is required.");
  });

  it("does not prompt or generate files in non-interactive dry runs", () => {
    const home = isolatedHome();
    const result = dryRun(home);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Starting first-time setup");
    expect(existsSync(localEnvPath(home))).toBe(false);
  });

  it("does not run setup when a shared local env already exists", () => {
    const home = isolatedHome();
    const existing = localEnvPath(home);
    mkdirSync(path.dirname(existing), { recursive: true });
    writeFileSync(existing, "PORT=45678\n");

    const result = interactiveDryRun("", home);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Starting first-time setup");
    expect(result.stdout).toContain("PORT=45678");
  });

  it("persists shell-derived host values while keeping Web Push secrets out by default", () => {
    const home = isolatedHome();
    const result = interactiveDryRun("\ny\nn\nn\nn\n", {
      ...home,
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: "shell.tail.ts.net",
      MULMOTERMINAL_ALLOWED_ORIGINS: "https://shell.tail.ts.net",
      MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY: "public-from-shell",
      MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY: "secret-from-shell",
      MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT: "mailto:shell@example.test",
    });
    const generated = readFileSync(localEnvPath(home), "utf8");

    expect(result.status).toBe(0);
    expect(generated).toContain("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=shell.tail.ts.net");
    expect(generated).toContain("MULMOTERMINAL_ALLOWED_ORIGINS=https://shell.tail.ts.net");
    expect(generated).not.toContain("public-from-shell");
    expect(generated).not.toContain("secret-from-shell");
    expect(generated).not.toContain("mailto:shell@example.test");
    expect(result.stdout).not.toContain("secret-from-shell");
    expect(result.stderr).not.toContain("secret-from-shell");
  });

  it("can save Web Push values without echoing the private key", () => {
    const home = isolatedHome();
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(binDir, '[[ "$1 $2" == "status --json" ]] || exit 1\nprintf \'{"Self":{"DNSName":"push.tail.ts.net"}}\\n\'');

    const result = interactiveDryRun("\ny\npublic-from-input\nprivate-from-input\nmailto:push@example.test\n", {
      ...home,
      PATH: prependPath(binDir),
    });
    const generated = readFileSync(localEnvPath(home), "utf8");

    expect(result.status).toBe(0);
    expect(generated).toContain("MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY=public-from-input");
    expect(generated).toContain("MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY=private-from-input");
    expect(generated).toContain("MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT=mailto:push@example.test");
    expect(result.stdout).not.toContain("private-from-input");
    expect(result.stderr).not.toContain("private-from-input");
  });
});
