// What the launcher adds to the server's environment — and, the reason this file exists, what
// it must NOT add. The server hands its own environment to every PTY it spawns, so anything
// set here is set in every terminal of every cell: NODE_ENV=production shipped from the first
// npx release until #955, where yarn v1 read it and installed without devDependencies while
// still printing "Done".
import { describe, it, expect } from "vitest";
import { serverSpawnEnv } from "../../bin/cli-args.js";

const PORT = 34567;
const CWD = "/Users/u/project";

describe("serverSpawnEnv", () => {
  it("adds the port as a string and the launch directory", () => {
    const env = serverSpawnEnv({ HOME: "/Users/u" }, PORT, CWD);
    expect(env.PORT).toBe("34567");
    expect(env.CLAUDE_CWD).toBe(CWD);
  });

  it("carries the rest of the environment through", () => {
    const env = serverSpawnEnv({ HOME: "/Users/u", PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-x" }, PORT, CWD);
    expect(env.HOME).toBe("/Users/u");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-x");
  });

  // Regression (#955): the whole bug was one extra key here.
  it("does not invent a NODE_ENV", () => {
    const env = serverSpawnEnv({ HOME: "/Users/u" }, PORT, CWD);
    expect("NODE_ENV" in env).toBe(false);
    expect(Object.keys(env).sort()).toEqual(["CLAUDE_CWD", "HOME", "PORT"]);
  });

  // The launcher decides what it ADDS. A user who runs their whole shell in one mode keeps it —
  // stripping it here would be the same bug pointed the other way.
  it.each(["production", "development", "test"])("passes a user's own NODE_ENV=%s through untouched", (value) => {
    expect(serverSpawnEnv({ NODE_ENV: value }, PORT, CWD).NODE_ENV).toBe(value);
  });

  it("never mutates the environment it was given", () => {
    const original = { HOME: "/Users/u" };
    serverSpawnEnv(original, PORT, CWD);
    expect(original).toEqual({ HOME: "/Users/u" });
  });
});
