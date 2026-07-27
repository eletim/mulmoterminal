// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #954, stated once over every call site rather than per route.
//
// `res.sendFile(<absolute path>)` runs `send`'s dotfile check across the WHOLE path, and the
// default `dotfiles: "ignore"` answers 404. Anything installed under a dot directory therefore
// fails — which is every `npx` run, since the package is expanded under `~/.npm/_npx/`. The
// SPA fallback had this and 404'd every reload; `/api/sound` had it and would 404 a chime kept
// in `~/.mulmoterminal/`. A third call site (dir-routes) had always passed `dotfiles: "allow"`
// and was fine, which is what made the other two read as oversights rather than decisions.
//
// The fix differs by site — a fixed serving root takes `root`, an arbitrary configured path
// takes `dotfiles` — so there is no single helper to funnel through. What CAN be shared is the
// requirement: every sendFile has to say which one it means.
const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../server");

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* tsFiles(full);
    else if (entry.name.endsWith(".ts")) yield full;
  }
}

/** Every `sendFile(` in the server, with the rest of its statement — enough to see the options
 *  object however the call is wrapped. */
function sendFileCalls(): { file: string; call: string }[] {
  const calls: { file: string; call: string }[] = [];
  for (const file of tsFiles(SERVER_DIR)) {
    const source = readFileSync(file, "utf-8");
    for (const match of source.matchAll(/sendFile\(/g)) {
      const end = source.indexOf(";", match.index);
      calls.push({ file: path.relative(SERVER_DIR, file), call: source.slice(match.index, end === -1 ? undefined : end) });
    }
  }
  return calls;
}

describe("every res.sendFile opts out of send's dotfile check", () => {
  it("finds the call sites at all (a rename must not silently empty this spec)", () => {
    expect(sendFileCalls().length).toBeGreaterThan(0);
  });

  it("passes either a root or an explicit dotfiles option", () => {
    const offenders = sendFileCalls()
      .filter(({ call }) => !/\broot\s*:/.test(call) && !/\bdotfiles\s*:/.test(call))
      .map(({ file, call }) => `${file}: ${call.split("\n")[0]}`);
    expect(offenders).toEqual([]);
  });
});
