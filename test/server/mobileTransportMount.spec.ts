// @vitest-environment node
//
// The exclusivity contract server/index.ts relies on: exactly one of the two mobile terminal
// transports is wired per mode, never both and never neither. Pulled into its own dispatcher
// (server/mobileTransportMount.ts) specifically so this is checkable against real production
// wiring rather than only by reading index.ts's call site.
import { describe, it, expect, vi } from "vitest";
import { mountMobileTransport } from "../../server/mobileTransportMount";

describe("mountMobileTransport", () => {
  it("mounts only the remote host for remote mode", () => {
    const mountRemote = vi.fn();
    const mountLocal = vi.fn();
    mountMobileTransport({ mode: "remote", mountRemote, mountLocal });
    expect(mountRemote).toHaveBeenCalledTimes(1);
    expect(mountLocal).not.toHaveBeenCalled();
  });

  it("mounts only the local terminal API for local mode", () => {
    const mountRemote = vi.fn();
    const mountLocal = vi.fn();
    mountMobileTransport({ mode: "local", mountRemote, mountLocal });
    expect(mountLocal).toHaveBeenCalledTimes(1);
    expect(mountRemote).not.toHaveBeenCalled();
  });
});
