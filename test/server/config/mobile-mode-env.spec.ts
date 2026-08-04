// @vitest-environment node
//
// server/config/env.ts parses MULMOTERMINAL_MOBILE_MODE once, at import time, into MOBILE_MODE —
// so the only way to see what it decided for a given env var value is to reload the module after
// setting the var. The import is inside each test on purpose: vi.resetModules() only takes
// effect on a LATER import, same as the vi.doMock case in CLAUDE.md.
import { describe, it, expect, afterEach, vi } from "vitest";

const original = process.env.MULMOTERMINAL_MOBILE_MODE;

async function loadMobileMode(value: string | undefined) {
  if (value === undefined) delete process.env.MULMOTERMINAL_MOBILE_MODE;
  else process.env.MULMOTERMINAL_MOBILE_MODE = value;
  vi.resetModules();
  return (await import("../../../server/config/env.js")).MOBILE_MODE;
}

afterEach(() => {
  if (original === undefined) delete process.env.MULMOTERMINAL_MOBILE_MODE;
  else process.env.MULMOTERMINAL_MOBILE_MODE = original;
});

describe("MOBILE_MODE", () => {
  it("defaults to remote when unset, so existing installs keep today's behaviour", async () => {
    expect(await loadMobileMode(undefined)).toBe("remote");
  });

  it("accepts remote explicitly", async () => {
    expect(await loadMobileMode("remote")).toBe("remote");
  });

  it("accepts local", async () => {
    expect(await loadMobileMode("local")).toBe("local");
  });

  it("fails startup on an unrecognised value rather than silently falling back to remote", async () => {
    await expect(loadMobileMode("foo")).rejects.toThrow(/Invalid MULMOTERMINAL_MOBILE_MODE: "foo"/);
  });

  it("fails on an empty string", async () => {
    await expect(loadMobileMode("")).rejects.toThrow(/Invalid MULMOTERMINAL_MOBILE_MODE/);
  });

  it("fails on a differently-cased value — the check is exact, not case-insensitive", async () => {
    await expect(loadMobileMode("LOCAL")).rejects.toThrow(/Invalid MULMOTERMINAL_MOBILE_MODE: "LOCAL"/);
  });
});
