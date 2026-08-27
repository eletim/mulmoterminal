import { describe, expect, it } from "vitest";
import { withHistoryAdmissionClaim } from "../../../server/routes/ws-routes.js";

describe("history resume admission", () => {
  it("serializes the Core lookup-to-create window for one history reference", async () => {
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    const order: string[] = [];

    const first = withHistoryAdmissionClaim("history-1", async () => {
      order.push("first-start");
      await firstHeld;
      order.push("first-created");
    });
    const second = withHistoryAdmissionClaim("history-1", async () => {
      order.push("second-start");
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-created", "second-start"]);
  });

  it("does not serialize unrelated history references", async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = withHistoryAdmissionClaim("history-a", async () => {
      await held;
      order.push("a");
    });
    const second = withHistoryAdmissionClaim("history-b", async () => order.push("b"));

    await second;
    expect(order).toEqual(["b"]);
    release();
    await first;
  });
});
