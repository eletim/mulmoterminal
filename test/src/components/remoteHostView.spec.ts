// The toolbar's whole claim about the phone link. Before #823 it read `connected` alone,
// so a dead subscription still showed green — the exact reason a dropped channel went
// unnoticed until the phone failed to connect.
import { describe, it, expect } from "vitest";
import { remoteHostView } from "../../../src/components/remoteHostView.js";

describe("remoteHostView", () => {
  it("is Online only when the lifecycle is connected AND the channel is up", () => {
    const view = remoteHostView(true, "online");
    expect(view.label).toBe("Online");
    expect(view.online).toBe(true);
  });

  // The regression: connected, signed in, and completely unreachable.
  it("is NOT Online when the runner has given up under a connected lifecycle", () => {
    const view = remoteHostView(true, "offline");
    expect(view.label).toBe("Offline");
    expect(view.online).toBe(false);
  });

  it("says it is reconnecting while the runner re-subscribes", () => {
    const view = remoteHostView(true, "reconnecting");
    expect(view.label).toBe("Reconnecting…");
    expect(view.reconnecting).toBe(true);
    expect(view.online).toBe(false); // never green while the phone can't reach us
  });

  it("stays Offline when nothing is connected, whatever health claims", () => {
    expect(remoteHostView(false, "online").label).toBe("Offline");
    expect(remoteHostView(false, "offline").label).toBe("Offline");
  });

  // A disconnected lifecycle mid-reconnect should still read as the healing state rather
  // than a flat Offline — that is what tells the user to wait instead of clicking Connect.
  it("keeps the reconnecting state visible even without a connected lifecycle", () => {
    expect(remoteHostView(false, "reconnecting").reconnecting).toBe(true);
  });

  it("gives each state its own icon and tone", () => {
    const states = [remoteHostView(true, "online"), remoteHostView(true, "reconnecting"), remoteHostView(true, "offline")];
    expect(new Set(states.map((view) => view.icon)).size).toBe(3);
    expect(new Set(states.map((view) => view.toneClass)).size).toBe(3);
  });
});
