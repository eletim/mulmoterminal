import { describe, expect, it } from "vitest";
import { mobileAccessPath, mobileAccessUrl } from "../../src/mobileAccessUrl";

describe("mobileAccessUrl", () => {
  it.each([
    ["/", "/mobile"],
    ["/mulmoterminal/", "/mulmoterminal/mobile"],
    ["/apps/mulmo/", "/apps/mulmo/mobile"],
  ])("builds the mobile path for base path %s", (basePath, expected) => {
    expect(mobileAccessPath(basePath)).toBe(expected);
  });

  it("preserves protocol, host, and port from the current origin", () => {
    expect(mobileAccessUrl("https://host.example.com:8443", "/apps/mulmo/")).toBe("https://host.example.com:8443/apps/mulmo/mobile");
  });

  it("does not mix query or hash fragments into the mobile URL", () => {
    expect(mobileAccessUrl("http://localhost:5173", "/mulmoterminal/?from=/terminals#top")).toBe("http://localhost:5173/mulmoterminal/mobile");
  });
});
