// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

import { cleanupSessionDrops, dropExtension, dropsDir, ensureDropsDir, pruneOrphanDrops, saveDrop } from "../../../server/session/session-drops.js";

const SESSION = randomUUID();

afterEach(() => cleanupSessionDrops(SESSION));

// Every assertion below is about a real session id, for which a directory always exists —
// so a null here is the test's own setup failing, not the case under test.
function dirFor(sessionId: string): string {
  const dir = dropsDir(sessionId);
  if (dir === null) throw new Error(`no drops directory for ${sessionId}`);
  return dir;
}

describe("dropsDir", () => {
  it("names a directory under the drops root for a real session id", () => {
    expect(path.basename(dirFor(SESSION))).toBe(SESSION);
  });

  // Every caller already holds an id from randomUUID() or a SESSION_ID_RE match. Re-checking
  // is what keeps a crafted one from naming a path outside the drops root — the directory is
  // interpolated into a path that a later prune will remove recursively.
  it.each(["../../etc", "not-a-uuid", "", `${randomUUID()}/../..`])("refuses %j", (id) => {
    expect(dropsDir(id)).toBeNull();
  });
});

describe("dropExtension", () => {
  // A browser's type for a source file is unreliable in exactly the everyday case: .ts is
  // commonly reported as video/mp2t and most code files as an empty string. Taking the MIME
  // first would rename main.ts to .bin and the agent would then read a file whose type it
  // cannot tell.
  it("prefers the filename's suffix over the content type", () => {
    expect(dropExtension("main.ts", "video/mp2t")).toBe(".ts");
    expect(dropExtension("notes.md", "")).toBe(".md");
    expect(dropExtension("archive.tar.gz", "application/octet-stream")).toBe(".gz");
  });

  it("lower-cases the suffix so one file type has one extension", () => {
    expect(dropExtension("PHOTO.JPG", "")).toBe(".jpg");
  });

  it("falls back to the content type when there is no usable suffix", () => {
    expect(dropExtension(null, "image/png")).toBe(".png");
    expect(dropExtension("Makefile", "text/plain")).toBe(".txt");
    expect(dropExtension("", "application/pdf")).toBe(".pdf");
  });

  // The suffix is interpolated into a filename, so anything that could reshape a path or
  // collide with the `.tmp` staging name must not survive as one.
  it.each(["evil.../x", "x.a/b", "x.-", "x." + "z".repeat(17), "x. "])("ignores an unsafe suffix in %j", (name) => {
    expect(dropExtension(name, "image/png")).toBe(".png");
  });

  it("falls back to .bin when neither says anything usable", () => {
    expect(dropExtension(null, "application/x-unheard-of")).toBe(".bin");
  });
});

describe("saveDrop", () => {
  it("writes the bytes and returns a path inside the session's directory", () => {
    const saved = saveDrop(SESSION, Buffer.from("hello"), "text/plain", "greeting.txt");
    expect(path.dirname(saved)).toBe(dirFor(SESSION));
    expect(saved.endsWith(".txt")).toBe(true);
    expect(readFileSync(saved, "utf8")).toBe("hello");
  });

  // The request carries no path at all — only bytes, a type and a name we take one suffix
  // from. A name that tried to steer the path must leave no trace in it.
  it("never puts the client's filename in the path", () => {
    const saved = saveDrop(SESSION, Buffer.from("x"), "text/plain", "../../../etc/passwd");
    expect(path.dirname(saved)).toBe(dirFor(SESSION));
    expect(saved).not.toContain("passwd");
  });

  it("leaves no staging file behind", () => {
    saveDrop(SESSION, Buffer.from("x"), "image/png", "a.png");
    expect(readdirSync(dirFor(SESSION)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("gives two drops of the same name two paths", () => {
    const first = saveDrop(SESSION, Buffer.from("one"), "text/plain", "same.txt");
    const second = saveDrop(SESSION, Buffer.from("two"), "text/plain", "same.txt");
    expect(second).not.toBe(first);
    expect(readFileSync(first, "utf8")).toBe("one");
  });
});

describe("ensureDropsDir", () => {
  // tmp is world-readable by default and a dropped file is whatever the user had open.
  it("creates the directory private to this user", () => {
    expect(ensureDropsDir(SESSION)).toBe(dirFor(SESSION));
    // Mode bits are a POSIX concept; on Windows the check would assert the platform, not the code.
    if (process.platform !== "win32") expect(statSync(dirFor(SESSION)).mode & 0o777).toBe(0o700);
  });

  it("returns null rather than throwing for an id that is not ours", () => {
    expect(ensureDropsDir("../escape")).toBeNull();
  });
});

describe("pruneOrphanDrops", () => {
  const withRoot = (run: (root: string) => void) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "drops-spec-"));
    try {
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  const seed = (root: string, name: string) => {
    mkdirSync(path.join(root, name), { recursive: true });
    writeFileSync(path.join(root, name, "dropped.txt"), "x");
    return path.join(root, name);
  };

  it("removes a session that did not survive and keeps one that did", () => {
    withRoot((root) => {
      const live = randomUUID();
      const dead = randomUUID();
      seed(root, live);
      seed(root, dead);
      expect(pruneOrphanDrops(new Set([live]), root)).toEqual([dead]);
      expect(existsSync(path.join(root, live))).toBe(true);
      expect(existsSync(path.join(root, dead))).toBe(false);
    });
  });

  // The parent lives in os.tmpdir(), which is SHARED with every other program and user on the
  // host. "The directory is ours" is not a good enough reason to delete something we did not
  // write — this is the case where getting it wrong removes a stranger's files.
  it("leaves alone anything not named like a session id", () => {
    withRoot((root) => {
      seed(root, "someone-elses-work");
      seed(root, "com.apple.something");
      writeFileSync(path.join(root, "loose-file"), "x");
      expect(pruneOrphanDrops(new Set(), root)).toEqual([]);
      expect(existsSync(path.join(root, "someone-elses-work"))).toBe(true);
      expect(existsSync(path.join(root, "com.apple.something"))).toBe(true);
      expect(existsSync(path.join(root, "loose-file"))).toBe(true);
    });
  });

  it("reports nothing when the root has never been written", () => {
    expect(pruneOrphanDrops(new Set(), path.join(os.tmpdir(), `drops-spec-missing-${randomUUID()}`))).toEqual([]);
  });
});

describe("cleanupSessionDrops", () => {
  it("removes the session's directory and everything in it", () => {
    saveDrop(SESSION, Buffer.from("x"), "text/plain", "a.txt");
    expect(existsSync(dirFor(SESSION))).toBe(true);
    cleanupSessionDrops(SESSION);
    expect(existsSync(dirFor(SESSION))).toBe(false);
  });

  it("is safe for a session that never received a drop", () => {
    expect(() => cleanupSessionDrops(randomUUID())).not.toThrow();
  });
});
