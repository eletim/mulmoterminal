// @vitest-environment node
// Knowing which servers are alive (#1061). Two things depend on this and both used to guess:
// the launcher only noticed a peer when the PORT clashed, and the settings prune assumed the
// only PTYs that ever existed were its own.
import { describe, it, expect } from "vitest";
import { earliestStartedAt, isProcessAlive } from "../../bin/instances.js";

describe("isProcessAlive", () => {
  it("says yes for this very process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("says no for a pid that cannot exist", () => {
    // Nothing is pid 0 in the sense signal-0 tests; a huge pid is past every platform's range.
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(2 ** 31 - 1)).toBe(false);
  });

  it("says no for junk rather than throwing", () => {
    expect(isProcessAlive(Number.NaN)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
  });
});

describe("earliestStartedAt", () => {
  const entry = (startedAt: number | null) => ({ pid: 1, port: null, startedAt });

  it("is the moment the FIRST of them started — the cutoff a prune can trust", () => {
    expect(earliestStartedAt([entry(300), entry(100), entry(200)])).toBe(100);
  });

  it("is null when nothing else is running, which restores the unguarded prune", () => {
    expect(earliestStartedAt([])).toBeNull();
  });

  it("ignores an entry with no start time instead of treating it as time zero", () => {
    // Time zero would make every file "newer than the earliest peer" and stop the prune for good.
    expect(earliestStartedAt([entry(null), entry(500)])).toBe(500);
    expect(earliestStartedAt([entry(null)])).toBeNull();
  });
});
