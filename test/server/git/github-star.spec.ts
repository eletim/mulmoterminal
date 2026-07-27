// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import { interpretStarCheck, readStarState, starRepo } from "../../../server/git/github-star.js";

const STARRED = { ok: true, stdout: "", stderr: "" };
const NOT_STARRED = { ok: false, stdout: "", stderr: "gh: Not Found (HTTP 404)\n" };
const GH_MISSING = { ok: false, stdout: "", stderr: "gh not found (install the GitHub CLI and run `gh auth login`)" };

// The cache lives at module scope and is keyed by one constant, so each case runs on its own
// far-apart clock — an earlier case's entry is already older than the TTL by the time the next
// one reads it, and no case can be poisoned by the order the file happens to run in.
const at = (fixed: number, runGh: () => Promise<{ ok: boolean; stdout: string; stderr: string }>) => ({
  runGh,
  now: () => fixed,
  ttlMs: 60_000,
  unknownTtlMs: 5_000,
});

describe("interpretStarCheck", () => {
  it("reads exit 0 as starred (gh answers 204 with no output)", () => {
    expect(interpretStarCheck({ ok: true, stdout: "", stderr: "" })).toBe(true);
  });

  it("reads gh's 404 as not starred", () => {
    expect(interpretStarCheck({ ok: false, stdout: "", stderr: "gh: Not Found (HTTP 404)\n" })).toBe(false);
  });

  // The regression this whole matcher exists for: runGh's own missing-binary message contains
  // the words "not found", so a prose match would report a confident "not starred" for a
  // machine that has no gh at all — and the UI would then offer a button that does nothing.
  it("reads a missing gh as unknown, not as not-starred", () => {
    const stderr = "gh not found (install the GitHub CLI and run `gh auth login`)";
    expect(interpretStarCheck({ ok: false, stdout: "", stderr })).toBeNull();
  });

  it("reads an auth failure as unknown", () => {
    expect(interpretStarCheck({ ok: false, stdout: "", stderr: "gh: Bad credentials (HTTP 401)\n" })).toBeNull();
  });

  it("reads a network failure as unknown", () => {
    expect(interpretStarCheck({ ok: false, stdout: "", stderr: "dial tcp: lookup api.github.com: no such host\n" })).toBeNull();
  });

  it("reads an empty stderr failure as unknown", () => {
    expect(interpretStarCheck({ ok: false, stdout: "", stderr: "" })).toBeNull();
  });
});

describe("readStarState", () => {
  it("holds a real answer instead of spawning gh again", async () => {
    const run = vi.fn(async () => NOT_STARRED);
    const deps = at(1_000_000, run);
    expect(await readStarState(deps)).toBe(false);
    expect(await readStarState(deps)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("re-asks once the window has passed", async () => {
    let clock = 2_000_000;
    const run = vi.fn(async () => NOT_STARRED);
    const deps = { runGh: run, now: () => clock, ttlMs: 60_000, unknownTtlMs: 5_000 };
    await readStarState(deps);
    clock += 60_001;
    await readStarState(deps);
    expect(run).toHaveBeenCalledTimes(2);
  });

  // The read is a GET, so no origin check can gate it. Without throttling the unknown path too,
  // a looping cross-site page spawns gh without bound on exactly the machines where gh is broken.
  it("throttles a repeated unknown instead of spawning gh each time", async () => {
    const run = vi.fn(async () => GH_MISSING);
    const deps = at(3_000_000, run);
    expect(await readStarState(deps)).toBeNull();
    expect(await readStarState(deps)).toBeNull();
    expect(await readStarState(deps)).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  // Short, though: the user may be running `gh auth login` right now, and a minute of stale
  // "cannot tell" would leave the button a plain link long after gh started working.
  it("retries an unknown soon after, not a full answer window later", async () => {
    let clock = 4_000_000;
    const run = vi.fn(async () => GH_MISSING);
    const deps = { runGh: run, now: () => clock, ttlMs: 60_000, unknownTtlMs: 5_000 };
    await readStarState(deps);
    clock += 5_001;
    await readStarState(deps);
    expect(run).toHaveBeenCalledTimes(2);
  });

  // A recovered gh must win immediately over the throttled unknown that preceded it.
  it("prefers a real answer over an expired unknown", async () => {
    let clock = 5_000_000;
    const failing = vi.fn(async () => GH_MISSING);
    expect(await readStarState({ runGh: failing, now: () => clock, ttlMs: 60_000, unknownTtlMs: 5_000 })).toBeNull();
    clock += 5_001;
    const working = vi.fn(async () => STARRED);
    expect(await readStarState({ runGh: working, now: () => clock, ttlMs: 60_000, unknownTtlMs: 5_000 })).toBe(true);
    expect(working).toHaveBeenCalledOnce();
  });
});

describe("starRepo", () => {
  it("reports success and answers later reads from the cache", async () => {
    const put = vi.fn(async () => STARRED);
    expect(await starRepo(at(6_000_000, put))).toBe(true);
    expect(put).toHaveBeenCalledWith(["api", "-X", "PUT", "/user/starred/receptron/mulmoterminal"]);

    const read = vi.fn(async () => NOT_STARRED);
    expect(await readStarState(at(6_000_000, read))).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it("reports failure and leaves the state unheld", async () => {
    const put = vi.fn(async () => GH_MISSING);
    expect(await starRepo(at(7_000_000, put))).toBe(false);

    const read = vi.fn(async () => NOT_STARRED);
    expect(await readStarState(at(7_000_000, read))).toBe(false);
    expect(read).toHaveBeenCalledOnce();
  });
});
