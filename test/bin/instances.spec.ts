// @vitest-environment node
// Knowing which servers are alive (#1061). Two things depend on this and both used to guess:
// the launcher only noticed a peer when the PORT clashed, and the settings prune assumed the
// only PTYs that ever existed were its own.
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { earliestStartedAt, isProcessAlive, liveInstances, registerInstance } from "../../bin/instances.js";

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

// The registry is only useful if a LIVE peer stays in it. Codex caught the first version deleting
// any entry it failed to parse — so a reader arriving mid-write would permanently erase a running
// peer, and the over-pruning this whole change prevents would come straight back.
describe("liveInstances — a live peer must not be erasable", () => {
  const dirs: string[] = [];
  const withHome = <T>(run: () => T): T => {
    const home = mkdtempHome();
    const prev = process.env.HOME;
    process.env.HOME = home;
    try {
      return run();
    } finally {
      if (prev === undefined) delete process.env.HOME;
      else process.env.HOME = prev;
    }
  };
  const mkdtempHome = () => {
    const dir = path.join(tmpdir(), `mt-instances-${process.pid}-${dirs.length}`);
    mkdirSync(path.join(dir, ".mulmoterminal", "instances"), { recursive: true });
    dirs.push(dir);
    return dir;
  };
  const entriesDir = () => path.join(process.env.HOME ?? "", ".mulmoterminal", "instances");
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("leaves an entry it cannot parse alone, instead of deleting it", () => {
    withHome(() => {
      writeFileSync(path.join(entriesDir(), "999999.json"), '{"pid":9999'); // caught mid-write
      liveInstances(process.pid);
      expect(readdirSync(entriesDir())).toContain("999999.json");
    });
  });

  it("removes an entry whose owner is genuinely gone", () => {
    withHome(() => {
      writeFileSync(path.join(entriesDir(), "2147483647.json"), JSON.stringify({ pid: 2147483647, port: 1, startedAt: 1 }));
      expect(liveInstances(process.pid)).toEqual([]);
      expect(readdirSync(entriesDir())).not.toContain("2147483647.json");
    });
  });

  it("reports a registered peer and never itself", () => {
    withHome(() => {
      // This process is alive, so registering it and asking as somebody else must find it.
      registerInstance(34567);
      expect(liveInstances(process.pid)).toEqual([]);
      const asPeer = liveInstances(process.pid + 1);
      expect(asPeer.map((i) => i.port)).toEqual([34567]);
    });
  });

  it("leaves no partial file behind for a reader to trip over", () => {
    withHome(() => {
      registerInstance(34567);
      expect(readdirSync(entriesDir()).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    });
  });
});
