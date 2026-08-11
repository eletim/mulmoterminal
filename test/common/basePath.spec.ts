import { describe, expect, it } from "vitest";
import { basePathPrefix, normalizeBasePath, stripBasePath, withBasePath } from "../../common/basePath";

describe("base path helpers", () => {
  it("keeps the default as root", () => {
    expect(normalizeBasePath(undefined)).toBe("/");
    expect(normalizeBasePath("")).toBe("/");
    expect(basePathPrefix("/")).toBe("");
  });

  it("normalizes configured subpaths", () => {
    expect(normalizeBasePath("mulmoterminal")).toBe("/mulmoterminal/");
    expect(normalizeBasePath("/mulmoterminal")).toBe("/mulmoterminal/");
    expect(normalizeBasePath("/mulmoterminal/?x=1")).toBe("/mulmoterminal/");
  });

  it("prefixes absolute app-server paths once", () => {
    expect(withBasePath("/api/config", "/mulmoterminal/")).toBe("/mulmoterminal/api/config");
    expect(withBasePath("/mulmoterminal/api/config", "/mulmoterminal/")).toBe("/mulmoterminal/api/config");
    expect(withBasePath("api/config", "/mulmoterminal/")).toBe("api/config");
  });

  it("strips the configured prefix for server routing", () => {
    expect(stripBasePath("/mulmoterminal/api/config", "/mulmoterminal/")).toBe("/api/config");
    expect(stripBasePath("/mulmoterminal", "/mulmoterminal/")).toBe("/");
    expect(stripBasePath("/api/config", "/mulmoterminal/")).toBe("/api/config");
  });
});
