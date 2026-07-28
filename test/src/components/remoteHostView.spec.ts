// The toolbar's whole claim about the phone link. Before #823 it read `connected` alone,
// so a dead subscription still showed green — the exact reason a dropped channel went
// unnoticed until the phone failed to connect.
import { describe, it, expect } from "vitest";
import { remoteHostAlarm, remoteHostView } from "../../../src/components/remoteHostView.js";

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

// The toolbar icon is the only part visible without opening anything, and offline used to
// render there as nothing at all — the same grey `phonelink` as a link that was never set up.
describe("remoteHostAlarm", () => {
  const loaded = true;
  const parked = true;

  it("raises alarm for a link that was set up and is now unreachable", () => {
    expect(remoteHostAlarm(remoteHostView(false, "offline"), parked, loaded)).toBe(true);
    expect(remoteHostAlarm(remoteHostView(true, "offline"), parked, loaded)).toBe(true);
  });

  it("stays quiet for someone who never connected the phone", () => {
    // Most people never use this. A toolbar permanently red for a feature they did not ask
    // for is worse than silence.
    expect(remoteHostAlarm(remoteHostView(false, "offline"), false, loaded)).toBe(false);
  });

  it("stays quiet after an explicit Disconnect", () => {
    // Disconnect drops the parked blob, so choosing to switch the link off is not an alarm.
    expect(remoteHostAlarm(remoteHostView(false, "offline"), false, loaded)).toBe(false);
  });

  it("stays quiet while the runner is healing itself", () => {
    expect(remoteHostAlarm(remoteHostView(true, "reconnecting"), parked, loaded)).toBe(false);
  });

  it("stays quiet when online", () => {
    expect(remoteHostAlarm(remoteHostView(true, "online"), parked, loaded)).toBe(false);
  });

  it("stays quiet until the server has answered once", () => {
    // Every ref starts at its disconnected default, so without this a page load would flash
    // red before the first status arrives.
    expect(remoteHostAlarm(remoteHostView(false, "offline"), parked, false)).toBe(false);
  });
});
