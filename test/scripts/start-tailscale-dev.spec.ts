// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webPush from "web-push";
import { makeTempDir } from "../support/tempDir.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "start-tailscale-dev.sh");
const BASH = "/usr/bin/bash";

let dir: string | null = null;
let rootEnvSnapshot: string | null | undefined;

afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  dir = null;
  if (rootEnvSnapshot !== undefined) {
    const rootEnv = path.join(ROOT, ".env");
    if (rootEnvSnapshot === null) rmSync(rootEnv, { force: true });
    else writeFileSync(rootEnv, rootEnvSnapshot);
    rootEnvSnapshot = undefined;
  }
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
  return interactiveDryRunFrom(ROOT, input, extra);
}

function interactiveDryRunFrom(cwd: string, input: string, extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(BASH, [SCRIPT], {
    cwd,
    env: cleanEnv({ MULMOTERMINAL_START_DRY_RUN: "1", MULMOTERMINAL_START_FORCE_INTERACTIVE: "1", ...extra }),
    input,
    encoding: "utf8",
  });
}

function runScript(extra: NodeJS.ProcessEnv = {}, input?: string) {
  return spawnSync(BASH, [SCRIPT], {
    cwd: ROOT,
    env: cleanEnv({ MULMOTERMINAL_ENV_FILES: "", ...extra }),
    input,
    encoding: "utf8",
  });
}

function interactiveRunScript(input: string, extra: NodeJS.ProcessEnv = {}) {
  return runScript({ MULMOTERMINAL_START_FORCE_INTERACTIVE: "1", ...extra }, input);
}

function interactiveRunScriptWithDefaultEnv(input: string, extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(BASH, [SCRIPT], {
    cwd: ROOT,
    env: cleanEnv({ MULMOTERMINAL_START_FORCE_INTERACTIVE: "1", ...extra }),
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

function writeFakeYarn(binDir: string) {
  mkdirSync(binDir, { recursive: true });
  const executable = path.join(binDir, "yarn");
  writeFileSync(
    executable,
    [
      "#!/usr/bin/env bash",
      "printf 'YARN %s %s\\n' \"$1\" \"$2\"",
      "printf 'ENV PORT=%s CLIENT_PORT=%s VITE_HOST=%s ORIGINS=%s\\n' \"$PORT\" \"$CLIENT_PORT\" \"${MULMOTERMINAL_VITE_HOST:-}\" \"${MULMOTERMINAL_ALLOWED_ORIGINS:-}\"",
      "",
    ].join("\n"),
  );
  chmodSync(executable, 0o755);
}

function parseEnv(contents: string) {
  return Object.fromEntries(
    contents
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function writeRootEnv(contents: string) {
  const rootEnv = path.join(ROOT, ".env");
  if (rootEnvSnapshot === undefined) rootEnvSnapshot = existsSync(rootEnv) ? readFileSync(rootEnv, "utf8") : null;
  writeFileSync(rootEnv, contents);
}

function expectUsableVapidKeys(env: Record<string, string>, subject: string) {
  expect(env.MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT).toBe(subject);
  expect(env.MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY).toMatch(/^B[A-Za-z0-9_-]+$/);
  expect(env.MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(() =>
    webPush.getVapidHeaders(
      "https://push.example/send",
      env.MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT,
      env.MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY,
      env.MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY,
      "aes128gcm",
    ),
  ).not.toThrow();
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

  it("defaults the Tailscale mode to auto", () => {
    const result = dryRun();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[mulmoterminal] tailscale mode https");
  });

  it("uses HTTPS mode when Tailscale Serve succeeds", () => {
    dir = makeTempDir("tailscale-https-success-");
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(
      binDir,
      '[[ "$1 $2" == "serve --bg" ]] || exit 1\nprintf "serve ok\\n"',
    );
    writeFakeYarn(binDir);

    const result = runScript({
      MULMOTERMINAL_TAILSCALE_MODE: "https",
      PATH: prependPath(binDir),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("serve ok");
    expect(result.stdout).toContain("[mulmoterminal] tailscale mode https");
    expect(result.stdout).toContain("YARN dev");
    expect(result.stdout).not.toContain("VITE_HOST=0.0.0.0");
  });

  it("does not fall back to HTTP when explicit HTTPS mode cannot configure Serve", () => {
    dir = makeTempDir("tailscale-https-fail-");
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(
      binDir,
      'if [[ "$1 $2" == "serve --bg" ]]; then echo "serve failed" >&2; exit 7; fi\nif [[ "$1 $2" == "ip -4" ]]; then printf "100.64.0.23\\n"; exit 0; fi\nexit 1',
    );
    writeFakeYarn(binDir);

    const result = runScript({
      MULMOTERMINAL_TAILSCALE_MODE: "https",
      PATH: prependPath(binDir),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("serve failed");
    expect(result.stderr).toContain("Tailscale Serve could not be configured");
    expect(result.stdout).not.toContain("YARN dev");
    expect(result.stdout).not.toContain("100.64.0.23");
  });

  it("does not call Tailscale Serve in explicit HTTP mode", () => {
    dir = makeTempDir("tailscale-http-bin-");
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(
      binDir,
      'if [[ "$1 $2" == "serve --bg" ]]; then echo "serve should not run" >&2; exit 44; fi\n[[ "$1 $2" == "ip -4" ]] || exit 1\nprintf "100.64.0.23\\n"',
    );

    const result = dryRun({
      MULMOTERMINAL_TAILSCALE_MODE: "http",
      PATH: prependPath(binDir),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("tailscale serve");
    expect(result.stderr).not.toContain("serve should not run");
    expect(result.stdout).toContain("[mulmoterminal] tailscale mode http");
    expect(result.stdout).toContain("MULMOTERMINAL_VITE_HOST=0.0.0.0");
    expect(result.stdout).toContain("MULMOTERMINAL_ALLOWED_ORIGINS=http://100.64.0.23:6857");
  });

  it("uses HTTPS in auto mode when Tailscale Serve succeeds", () => {
    dir = makeTempDir("tailscale-auto-success-");
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(
      binDir,
      '[[ "$1 $2" == "serve --bg" ]] || exit 1\nprintf "serve ok\\n"',
    );
    writeFakeYarn(binDir);

    const result = runScript({
      MULMOTERMINAL_TAILSCALE_MODE: "auto",
      PATH: prependPath(binDir),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("serve ok");
    expect(result.stdout).toContain("[mulmoterminal] tailscale mode https");
    expect(result.stdout).toContain("YARN dev");
    expect(result.stdout).not.toContain("ORIGINS=http://");
  });

  it("falls back to HTTP in auto mode when Serve fails and the user accepts", () => {
    dir = makeTempDir("tailscale-auto-yes-");
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(
      binDir,
      'if [[ "$1 $2" == "serve --bg" ]]; then echo "serve failed" >&2; exit 7; fi\n[[ "$1 $2" == "ip -4" ]] || exit 1\nprintf "100.64.0.23\\n"',
    );
    writeFakeYarn(binDir);

    const result = interactiveRunScript("\n", {
      MULMOTERMINAL_TAILSCALE_MODE: "auto",
      PATH: prependPath(binDir),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("serve failed");
    expect(result.stderr).toContain("Direct HTTP access is limited to devices on your Tailscale VPN");
    expect(result.stderr).toContain("Web Push and other HTTPS-only browser features may be unavailable");
    expect(result.stdout).toContain("[mulmoterminal] tailscale mode http");
    expect(result.stdout).toContain("VITE_HOST=0.0.0.0");
    expect(result.stdout).toContain("ORIGINS=http://100.64.0.23:6857");
  });

  it("generates HTTP first-time setup values after accepted auto fallback", () => {
    const home = isolatedHome();
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(
      binDir,
      'if [[ "$1 $2" == "serve --bg" ]]; then echo "serve failed" >&2; exit 7; fi\n[[ "$1 $2" == "ip -4" ]] || exit 1\nprintf "100.64.0.23\\n"',
    );
    writeFakeYarn(binDir);

    const result = interactiveRunScriptWithDefaultEnv("\n\n", {
      ...home,
      MULMOTERMINAL_TAILSCALE_MODE: "auto",
      PATH: prependPath(binDir),
    });
    const generated = readFileSync(localEnvPath(home), "utf8");

    expect(result.status).toBe(0);
    expect(generated).toContain("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=100.64.0.23");
    expect(generated).toContain("MULMOTERMINAL_ALLOWED_ORIGINS=http://100.64.0.23:6857");
    expect(generated).not.toContain("https://100.64.0.23");
    expect(generated).not.toContain("MULMOTERMINAL_MOBILE_WEB_PUSH_");
  });

  it("exits in auto mode when Serve fails and the user declines HTTP fallback", () => {
    dir = makeTempDir("tailscale-auto-no-");
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(
      binDir,
      'if [[ "$1 $2" == "serve --bg" ]]; then echo "serve failed" >&2; exit 7; fi\n[[ "$1 $2" == "ip -4" ]] || exit 1\nprintf "100.64.0.23\\n"',
    );
    writeFakeYarn(binDir);

    const result = interactiveRunScript("n\n", {
      MULMOTERMINAL_TAILSCALE_MODE: "auto",
      PATH: prependPath(binDir),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("HTTP fallback was declined");
    expect(result.stdout).not.toContain("YARN dev");
  });

  it("refuses auto HTTP fallback without confirmation in non-interactive mode", () => {
    dir = makeTempDir("tailscale-auto-noninteractive-");
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(
      binDir,
      'if [[ "$1 $2" == "serve --bg" ]]; then echo "serve failed" >&2; exit 7; fi\n[[ "$1 $2" == "ip -4" ]] || exit 1\nprintf "100.64.0.23\\n"',
    );
    writeFakeYarn(binDir);

    const result = runScript({
      MULMOTERMINAL_TAILSCALE_MODE: "auto",
      PATH: prependPath(binDir),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to downgrade from HTTPS to HTTP without confirmation");
    expect(result.stdout).not.toContain("YARN dev");
  });

  it("keeps the legacy HTTP env as an alias when the new mode is not set", () => {
    dir = makeTempDir("tailscale-http-legacy-");
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(binDir, '[[ "$1 $2" == "ip -4" ]] || exit 1\nprintf "100.64.0.24\\n"');

    const result = dryRun({
      MULMOTERMINAL_TAILSCALE_HTTP: "1",
      PATH: prependPath(binDir),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[mulmoterminal] tailscale mode http");
    expect(result.stdout).toContain("MULMOTERMINAL_ALLOWED_ORIGINS=http://100.64.0.24:6857");
  });

  it("prefers the new mode over the legacy HTTP env when both are set", () => {
    const result = dryRun({
      MULMOTERMINAL_TAILSCALE_MODE: "https",
      MULMOTERMINAL_TAILSCALE_HTTP: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tailscale serve --bg");
    expect(result.stdout).toContain("[mulmoterminal] tailscale mode https");
    expect(result.stdout).not.toContain("MULMOTERMINAL_ALLOWED_ORIGINS=http://");
  });

  it("fails fast for invalid Tailscale mode values", () => {
    const result = dryRun({ MULMOTERMINAL_TAILSCALE_MODE: "maybe" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid MULMOTERMINAL_TAILSCALE_MODE=maybe");
    expect(result.stderr).toContain("Expected one of: auto, https, http");
    expect(result.stdout).not.toContain("yarn dev");
  });

  it("uses the Tailscale IPv4 address and skips Web Push setup for HTTP first-time setup", () => {
    const home = isolatedHome();
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(binDir, '[[ "$1 $2" == "ip -4" ]] || exit 1\nprintf \'100.64.0.23\\n\'');

    const result = interactiveDryRun("\n", {
      ...home,
      PATH: prependPath(binDir),
      MULMOTERMINAL_TAILSCALE_MODE: "http",
    });
    const generated = readFileSync(localEnvPath(home), "utf8");

    expect(result.status).toBe(0);
    expect(generated).toContain("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=100.64.0.23");
    expect(generated).toContain("MULMOTERMINAL_ALLOWED_ORIGINS=http://100.64.0.23:6857");
    expect(generated).not.toContain("MULMOTERMINAL_MOBILE_WEB_PUSH_");
    expect(result.stdout).not.toContain("Web Push keys were not found");
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

  it("persists shell-derived host values without prompting to save existing Web Push secrets", () => {
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
    expect(result.stdout).not.toContain("Web Push keys were not found");
  });

  it("loads repo .env before first-time setup so existing Web Push keys are not regenerated", () => {
    const home = isolatedHome();
    writeRootEnv(
      [
        "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=env.tail.ts.net",
        "MULMOTERMINAL_ALLOWED_ORIGINS=https://env.tail.ts.net",
        "MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY=public-from-env",
        "MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY=secret-from-env",
        "MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT=mailto:env@example.test",
        "",
      ].join("\n"),
    );

    const result = interactiveDryRun("\n", home);
    const generated = readFileSync(localEnvPath(home), "utf8");

    expect(result.status).toBe(0);
    expect(generated).toContain("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=env.tail.ts.net");
    expect(generated).toContain("MULMOTERMINAL_ALLOWED_ORIGINS=https://env.tail.ts.net");
    expect(generated).not.toContain("public-from-env");
    expect(generated).not.toContain("secret-from-env");
    expect(generated).not.toContain("mailto:env@example.test");
    expect(result.stdout).not.toContain("Web Push keys were not found");
    expect(result.stdout).not.toContain("secret-from-env");
    expect(result.stderr).not.toContain("secret-from-env");
  });

  it("generates usable Web Push keys and a default subject without echoing the private key", () => {
    const home = isolatedHome();
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(binDir, '[[ "$1 $2" == "status --json" ]] || exit 1\nprintf \'{"Self":{"DNSName":"push.tail.ts.net"}}\\n\'');

    const result = interactiveDryRun("\n\n\n", {
      ...home,
      PATH: prependPath(binDir),
    });
    const generated = readFileSync(localEnvPath(home), "utf8");
    const env = parseEnv(generated);

    expect(result.status).toBe(0);
    expectUsableVapidKeys(env, "https://push.tail.ts.net");
    expect(result.stdout).toContain("Web Push keys were not found.");
    expect(result.stdout).not.toContain(env.MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY);
    expect(result.stderr).not.toContain(env.MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY);
  });

  it("generates Web Push keys when launched from outside the repository root", () => {
    const home = isolatedHome();
    const outside = path.join(currentTempDir(), "outside");
    const binDir = path.join(currentTempDir(), "bin");
    mkdirSync(outside);
    writeFakeTailscale(binDir, '[[ "$1 $2" == "status --json" ]] || exit 1\nprintf \'{"Self":{"DNSName":"outside.tail.ts.net"}}\\n\'');

    const result = interactiveDryRunFrom(outside, "\n\n\n", {
      ...home,
      PATH: prependPath(binDir),
    });
    const generated = readFileSync(localEnvPath(home), "utf8");
    const env = parseEnv(generated);

    expect(result.status).toBe(0);
    expectUsableVapidKeys(env, "https://outside.tail.ts.net");
    expect(result.stderr).not.toContain("Could not generate Web Push keys");
  });

  it("starts without Web Push when automatic key generation is rejected", () => {
    const home = isolatedHome();
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(binDir, '[[ "$1 $2" == "status --json" ]] || exit 1\nprintf \'{"Self":{"DNSName":"push-disabled.tail.ts.net"}}\\n\'');

    const result = interactiveDryRun("\nn\n", { ...home, PATH: prependPath(binDir) });
    const generated = readFileSync(localEnvPath(home), "utf8");

    expect(result.status).toBe(0);
    expect(generated).not.toContain("MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY");
    expect(generated).not.toContain("MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY");
    expect(generated).not.toContain("MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT");
    expect(result.stdout).toContain("yarn dev");
  });

  it("reuses generated Web Push keys from the shared config on the next run without prompting", () => {
    const home = isolatedHome();
    const binDir = path.join(currentTempDir(), "bin");
    writeFakeTailscale(binDir, '[[ "$1 $2" == "status --json" ]] || exit 1\nprintf \'{"Self":{"DNSName":"reuse.tail.ts.net"}}\\n\'');

    const first = interactiveDryRun("\n\n\n", { ...home, PATH: prependPath(binDir) });
    const firstGenerated = readFileSync(localEnvPath(home), "utf8");
    const firstEnv = parseEnv(firstGenerated);
    const second = interactiveDryRun("", { ...home, PATH: prependPath(binDir) });
    const secondGenerated = readFileSync(localEnvPath(home), "utf8");
    const secondEnv = parseEnv(secondGenerated);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain("Starting first-time setup");
    expect(second.stdout).not.toContain("Web Push keys were not found");
    expect(secondEnv.MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY).toBe(firstEnv.MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY);
    expect(secondEnv.MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY).toBe(firstEnv.MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY);
  });
});
