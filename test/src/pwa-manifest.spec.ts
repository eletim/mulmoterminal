// @vitest-environment jsdom
// The app-side mobile PWA contract: the SPA shell links the manifest, the manifest starts
// inside the mobile route, and PWA scope stays separate from the existing Web Push SW scope.
import { describe, expect, it } from "vitest";
import { MOBILE_WEB_PUSH_SW_SCOPE, MOBILE_WEB_PUSH_SW_URL } from "../../src/mobileWebPushClient.js";
import { routes } from "../../src/router/index.js";
import indexHtml from "../../index.html?raw";
import manifestSource from "../../public/manifest.webmanifest?raw";

const manifest = JSON.parse(manifestSource) as {
  name?: string;
  short_name?: string;
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  theme_color?: string;
  background_color?: string;
  icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
};

describe("mobile PWA manifest", () => {
  it("is linked from the SPA shell with mobile theme metadata", () => {
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(indexHtml).toContain('<meta name="theme-color" content="#1a1a2e" />');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/icons/mulmoterminal-180.png" />');
  });

  it("has installable mobile app fields without splitting local and remote mobile", () => {
    expect(manifest).toMatchObject({
      name: "MulmoTerminal Mobile",
      short_name: "MulmoTerm",
      id: "/mobile/terminals",
      start_url: "/mobile/terminals",
      scope: "/mobile/",
      display: "standalone",
      theme_color: "#1a1a2e",
      background_color: "#1a1a2e",
    });
  });

  it("starts inside the dedicated mobile terminal route", async () => {
    const { createRouter, createMemoryHistory } = await import("vue-router");
    const router = createRouter({ history: createMemoryHistory(), routes });

    await router.push(manifest.start_url ?? "");

    expect(router.currentRoute.value.name).toBe("mobileTerminals");
  });

  it("declares the required PNG icon sizes for installability", () => {
    const pngIcons = manifest.icons?.filter((icon) => icon.type === "image/png") ?? [];

    expect(pngIcons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/mulmoterminal-192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/icons/mulmoterminal-512.png", sizes: "512x512" }),
      ]),
    );
    expect(manifest.icons?.some((icon) => icon.purpose?.includes("maskable"))).toBe(true);
  });

  it("keeps PWA manifest scope separate from the existing Web Push Service Worker scope", () => {
    expect(manifest.scope).toBe("/mobile/");
    expect(MOBILE_WEB_PUSH_SW_URL).toBe("/mobile-web-push-sw.js");
    expect(MOBILE_WEB_PUSH_SW_SCOPE).toBe("/");
    expect("serviceworker" in manifest).toBe(false);
    expect("service_worker" in manifest).toBe(false);
  });
});
