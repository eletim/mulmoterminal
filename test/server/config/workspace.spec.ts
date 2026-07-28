import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspace, workspaceFromQuery, existingWorkspace, existingWorkspaceFromQuery } from "../../../server/config/workspace.js";
import { CLAUDE_CWD } from "../../../server/config/env.js";

// resolveWorkspace guards what becomes a PTY's cwd, so every rejection matters: anything
// it lets through unchecked is a path the client chose.
describe("resolveWorkspace", () => {
  let dir = "";
  let file = "";

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mt-ws-"));
    file = path.join(dir, "a-file");
    await fs.writeFile(file, "");
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("accepts an absolute path to an existing directory", () => {
    expect(resolveWorkspace(dir)).toBe(dir);
  });

  it("falls back for a relative path, however real it is", () => {
    expect(resolveWorkspace("server")).toBe(CLAUDE_CWD);
    expect(resolveWorkspace("./server")).toBe(CLAUDE_CWD);
    expect(resolveWorkspace("../mulmoterminal")).toBe(CLAUDE_CWD);
  });

  it("falls back for a path that does not exist", () => {
    expect(resolveWorkspace(path.join(dir, "no-such-dir"))).toBe(CLAUDE_CWD);
  });

  it("falls back for a file — a cwd has to be a directory", () => {
    expect(resolveWorkspace(file)).toBe(CLAUDE_CWD);
  });

  it("falls back for null and for empty", () => {
    expect(resolveWorkspace(null)).toBe(CLAUDE_CWD);
    expect(resolveWorkspace("")).toBe(CLAUDE_CWD);
  });
});

describe("workspaceFromQuery", () => {
  it("resolves a string query", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mt-wsq-"));
    expect(workspaceFromQuery(dir)).toBe(dir);
    await fs.rm(dir, { recursive: true, force: true });
  });

  // Express hands over an array when a param repeats (?cwd=a&cwd=b) and undefined when it
  // is absent; neither may reach the validation as a path.
  it("falls back for anything that is not a string", () => {
    expect(workspaceFromQuery(undefined)).toBe(CLAUDE_CWD);
    expect(workspaceFromQuery(["/tmp", "/etc"])).toBe(CLAUDE_CWD);
    expect(workspaceFromQuery(42)).toBe(CLAUDE_CWD);
    expect(workspaceFromQuery(null)).toBe(CLAUDE_CWD);
  });
});

// The fallback in resolveWorkspace is right for a route that RUNS somewhere and wrong for one
// that REPORTS on the directory it was asked about — that one would answer about a different
// directory under the requested one's name (Codex, #952).
describe("existingWorkspace", () => {
  it("returns a real directory unchanged", () => {
    expect(existingWorkspace(process.cwd())).toBe(process.cwd());
  });

  it("returns null instead of a fallback for a path that isn't there", () => {
    expect(existingWorkspace("/definitely/not/a/directory/here")).toBeNull();
    expect(existingWorkspace("relative/path")).toBeNull();
    expect(existingWorkspace(null)).toBeNull();
  });

  it("returns null for a file, which is not a workspace", () => {
    expect(existingWorkspace(new URL(import.meta.url).pathname)).toBeNull();
  });

  it("reads the query param the same way, rejecting a non-string", () => {
    expect(existingWorkspaceFromQuery(process.cwd())).toBe(process.cwd());
    expect(existingWorkspaceFromQuery(["/tmp"])).toBeNull();
    expect(existingWorkspaceFromQuery(undefined)).toBeNull();
  });
});

// #1002. These guards let `/a/b/` through — it is absolute and it stats as a directory — and the
// value they return is the identity the directory is known by from then on: the PTY's cwd, the cwd
// echoed back to the cell, the key its dir-config subscription uses, and the recorded preset.
// Returned verbatim, one directory had two names, and a `.mulmoterminal.json` change announced on
// the canonical one never reached a cell launched from the other.
describe("canonical spelling of the accepted directory", () => {
  let dir = "";

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mt-ws-canon-"));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("drops a trailing separator — the shape tab-completion leaves behind", () => {
    expect(resolveWorkspace(dir + path.sep)).toBe(dir);
    expect(existingWorkspace(dir + path.sep)).toBe(dir);
    expect(workspaceFromQuery(dir + path.sep)).toBe(dir);
    expect(existingWorkspaceFromQuery(dir + path.sep)).toBe(dir);
  });

  it("collapses . and .. inside an absolute path", () => {
    expect(resolveWorkspace(path.join(dir, "sub", ".."))).toBe(dir);
    expect(resolveWorkspace(path.join(dir, "."))).toBe(dir);
  });

  it("leaves an already-canonical path untouched", () => {
    expect(resolveWorkspace(dir)).toBe(dir);
  });

  // The guard order matters: canonicalizing BEFORE the isAbsolute check would splice a relative
  // string onto the server's own cwd and hand back a directory the client never asked for.
  it("still refuses a relative path rather than resolving it against the server's cwd", () => {
    expect(existingWorkspace("server")).toBeNull();
    expect(existingWorkspace("./server")).toBeNull();
  });

  it("keeps the filesystem root, whose separator is not trailing", () => {
    const root = path.parse(dir).root;
    expect(resolveWorkspace(root)).toBe(root);
  });
});
