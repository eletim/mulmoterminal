import { describe, it, expect, vi } from "vitest";
import { startRateLimitProbe } from "./rate-limit-probe";

const deps = (over: Partial<Parameters<typeof startRateLimitProbe>[0]> = {}) => ({
  spawn: () => ({ write: () => {}, kill: () => {} }),
  host: "localhost",
  port: 34567,
  cwd: "/tmp",
  sessionId: "s",
  onSettled: () => {},
  ...over,
});

describe("startRateLimitProbe", () => {
  // The caller marks a probe in flight BEFORE calling this, so an escape here would leave that flag
  // set with nothing to clear it and the gauge would stop refreshing for the life of the process.
  // Every failure has to arrive as the ordinary "this probe reported nothing".
  it("reports settled instead of throwing when the spawn fails", () => {
    const onSettled = vi.fn();
    const stop = startRateLimitProbe(
      deps({
        onSettled,
        spawn: () => {
          throw new Error("claude is not installed");
        },
      }),
    );
    expect(onSettled).toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  // Which is what a missing `claude` looks like from here — no branch of its own, because there is
  // nothing different to do about it.
  it("settles exactly once even when stopped again", () => {
    const onSettled = vi.fn();
    const stop = startRateLimitProbe(deps({ onSettled }));
    stop();
    stop();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("kills the terminal it started when stopped", () => {
    const kill = vi.fn();
    const stop = startRateLimitProbe(deps({ spawn: () => ({ write: () => {}, kill }) }));
    stop();
    expect(kill).toHaveBeenCalled();
  });

  // A PTY that has already exited makes kill() throw; stopping must still settle.
  it("still settles when killing throws", () => {
    const onSettled = vi.fn();
    const stop = startRateLimitProbe(
      deps({
        onSettled,
        spawn: () => ({
          write: () => {},
          kill: () => {
            throw new Error("already gone");
          },
        }),
      }),
    );
    expect(() => stop()).not.toThrow();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
