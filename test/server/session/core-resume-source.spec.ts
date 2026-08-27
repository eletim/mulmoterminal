import { describe, expect, it, vi } from "vitest";
import { persistCoreResumeSource, type CoreResumeSourceWriteDeps } from "../../../server/session/core-resume-source.js";

const deps = (setResumeSource: CoreResumeSourceWriteDeps["setResumeSource"]): CoreResumeSourceWriteDeps => ({
  setResumeSource,
  delay: vi.fn(async () => undefined),
  warn: vi.fn(),
  attempts: 4,
});

describe("persistCoreResumeSource", () => {
  it("retries transient Core metadata failures without creating a fallback store", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("busy")).mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
    const d = deps(write);

    expect(await persistCoreResumeSource("session-1", "resume-1", d)).toBe(true);
    expect(write).toHaveBeenCalledTimes(3);
    expect(d.delay).toHaveBeenCalledTimes(2);
    expect(d.warn).not.toHaveBeenCalled();
  });

  it("reports a terminal write failure after the bounded retries", async () => {
    const d = deps(vi.fn(async () => Promise.reject(new Error("gone"))));

    expect(await persistCoreResumeSource("session-1", "resume-1", d)).toBe(false);
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining("gone"));
  });
});
