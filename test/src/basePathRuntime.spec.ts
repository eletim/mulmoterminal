// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SoundConfig } from "../../src/composables/useAttentionSound";

afterEach(() => {
  Reflect.deleteProperty(window, "__MULMOTERMINAL_BASE_PATH__");
  vi.resetModules();
});

function setRuntimeBasePath(value: string): void {
  Object.defineProperty(window, "__MULMOTERMINAL_BASE_PATH__", { value, configurable: true });
}

describe("runtime base path", () => {
  it("prefixes server URLs that are opened or embedded without fetch", async () => {
    setRuntimeBasePath("/mulmoterminal/");

    const [{ rawFileUrl }, { soundSources }, { dropUploadUrl }] = await Promise.all([
      import("../../src/composables/terminalFilePathLinkProvider"),
      import("../../src/composables/useAttentionSound"),
      import("../../src/components/dropUpload"),
    ]);

    const config: SoundConfig = { kinds: ["finished"], sounds: {}, soundFile: "preset:coin" };

    expect(rawFileUrl("assets/a b.gif", "/repo/app")).toBe("/mulmoterminal/api/files/raw?cwd=%2Frepo%2Fapp&path=assets%2Fa%20b.gif");
    expect(soundSources("finished", "/repo/app", config).map((source) => source.url)).toEqual([
      "/mulmoterminal/api/dir-sound?cwd=%2Frepo%2Fapp&kind=finished",
      "/mulmoterminal/api/sound-preset/coin",
    ]);
    expect(dropUploadUrl("session-a")).toBe("/mulmoterminal/api/session/session-a/drop");
  });

  it("prefixes mobile Web Push service worker and API URLs", async () => {
    setRuntimeBasePath("/mulmoterminal/");

    const client = await import("../../src/mobileWebPushClient");

    expect(client.MOBILE_WEB_PUSH_SW_URL).toBe("/mulmoterminal/mobile-web-push-sw.js");
    expect(client.MOBILE_WEB_PUSH_SW_SCOPE).toBe("/mulmoterminal/");
    expect(client.MOBILE_WEB_PUSH_CONFIG_URL).toBe("/mulmoterminal/api/mobile/web-push/config");
    expect(client.MOBILE_WEB_PUSH_SUBSCRIPTIONS_URL).toBe("/mulmoterminal/api/mobile/web-push/subscriptions");
    expect(client.MOBILE_WEB_PUSH_TEST_URL).toBe("/mulmoterminal/api/mobile/web-push/test");
  });

  it("prefixes server URLs assigned directly to DOM attributes and properties", async () => {
    setRuntimeBasePath("/mulmoterminal/");
    const { installBasePathDomUrls } = await import("../../src/basePath");

    installBasePathDomUrls();

    const iframe = document.createElement("iframe");
    iframe.src = "/htmlfile/ws/docs/report.html";
    expect(iframe.getAttribute("src")).toBe("/mulmoterminal/htmlfile/ws/docs/report.html");

    const link = document.createElement("a");
    link.setAttribute("href", "/artifacts/html/report.html");
    expect(link.getAttribute("href")).toBe("/mulmoterminal/artifacts/html/report.html");
  });
});
