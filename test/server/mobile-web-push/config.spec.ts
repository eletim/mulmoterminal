// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mobileWebPushConfigFromEnv, publicMobileWebPushConfig } from "../../../server/mobile-web-push/config";

describe("mobileWebPushConfigFromEnv", () => {
  it("reads VAPID settings from the environment", () => {
    const config = mobileWebPushConfigFromEnv({
      MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY: "public",
      MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY: "private",
      MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT: "mailto:push@example.test",
    });

    expect(config).toEqual({
      enabled: true,
      vapid: { publicKey: "public", privateKey: "private", subject: "mailto:push@example.test" },
    });
  });

  it("disables Web Push when any VAPID setting is missing", () => {
    expect(mobileWebPushConfigFromEnv({}).enabled).toBe(false);
  });

  it("never exposes the private key in the public config", () => {
    expect(
      publicMobileWebPushConfig({
        enabled: true,
        vapid: { publicKey: "public", privateKey: "private", subject: "mailto:push@example.test" },
      }),
    ).toEqual({ enabled: true, publicKey: "public" });
  });
});
