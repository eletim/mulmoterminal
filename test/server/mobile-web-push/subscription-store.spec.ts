// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMobileWebPushSubscriptionStore,
  mobileWebPushSubscriptionsFile,
  parseMobileWebPushSubscription,
  type MobileWebPushSubscriptionInput,
} from "../../../server/mobile-web-push/subscription-store";

const dirs: string[] = [];

function tempFile(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mulmoterminal-web-push-"));
  dirs.push(dir);
  return mobileWebPushSubscriptionsFile(dir);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const subscription = (endpoint: string): MobileWebPushSubscriptionInput => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: "p256dh", auth: "auth" },
});

describe("parseMobileWebPushSubscription", () => {
  it("accepts the browser PushSubscription JSON shape", () => {
    expect(parseMobileWebPushSubscription(subscription("https://push.example/a"))).toEqual(subscription("https://push.example/a"));
  });

  it("rejects non-https endpoints and missing keys", () => {
    expect(parseMobileWebPushSubscription(subscription("http://push.example/a"))).toBeNull();
    expect(parseMobileWebPushSubscription({ endpoint: "https://push.example/a", keys: { p256dh: "x" } })).toBeNull();
  });
});

describe("createMobileWebPushSubscriptionStore", () => {
  it("deduplicates subscriptions by endpoint and updates the stored keys", async () => {
    const file = tempFile();
    const store = createMobileWebPushSubscriptionStore(file, () => new Date("2026-08-06T00:00:00Z"));
    await store.upsert(subscription("https://push.example/a"));
    const result = await store.upsert({ ...subscription("https://push.example/a"), keys: { p256dh: "new", auth: "auth2" } });

    expect(result).toEqual({ created: false, count: 1 });
    expect(await store.list()).toMatchObject([{ endpoint: "https://push.example/a", keys: { p256dh: "new", auth: "auth2" } }]);
  });

  it("removes endpoints and keeps unrelated subscriptions", async () => {
    const file = tempFile();
    const store = createMobileWebPushSubscriptionStore(file);
    await store.upsert(subscription("https://push.example/a"));
    await store.upsert(subscription("https://push.example/b"));

    expect(await store.removeEndpoints(["https://push.example/a", "https://push.example/missing"])).toEqual({ removed: 1, count: 1 });
    expect((await store.list()).map((entry) => entry.endpoint)).toEqual(["https://push.example/b"]);
  });

  it("drops malformed entries when reading an existing file", async () => {
    const file = tempFile();
    writeFileSync(
      file,
      JSON.stringify({
        subscriptions: [
          { ...subscription("https://push.example/a"), createdAt: "then", updatedAt: "now" },
          { endpoint: "https://push.example/b", createdAt: "then", updatedAt: "now" },
        ],
      }),
    );

    expect(await createMobileWebPushSubscriptionStore(file).list()).toMatchObject([{ endpoint: "https://push.example/a" }]);
    expect(readFileSync(file, "utf8")).toContain("push.example");
  });
});
