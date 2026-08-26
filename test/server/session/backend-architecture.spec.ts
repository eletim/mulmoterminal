// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sessionDir = path.join(root, "server", "session");

function typescriptSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return typescriptSources(target);
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  });
}

describe("backend session architecture", () => {
  it("has no backend lifecycle manager or reap policy module", () => {
    expect(existsSync(path.join(sessionDir, "lifecycle.ts"))).toBe(false);
    expect(existsSync(path.join(sessionDir, "reap-policy.ts"))).toBe(false);
  });

  it("does not wire removed lifecycle-manager operations into production", () => {
    const production = typescriptSources(path.join(root, "server"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    for (const removed of ["createSessionLifecycle", "cancelReap", "armReapForDetached", "cleanupManagedLiveSessions"]) {
      expect(production).not.toContain(removed);
    }
  });
});
