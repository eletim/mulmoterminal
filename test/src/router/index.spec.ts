import { describe, it, expect } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";
import { router, routes } from "../../../src/router/index";

describe("router route table", () => {
  it("resolves the terminal and files surfaces to their names", () => {
    expect(router.resolve("/terminals").name).toBe("terminals");
    expect(router.resolve("/files").name).toBe("files");
  });

  it("resolves /mobile/terminals to mobileTerminals", () => {
    expect(router.resolve("/mobile/terminals").name).toBe("mobileTerminals");
  });

  it("redirects the short /mobile entry to the mobile terminal page", async () => {
    const mem = createRouter({ history: createMemoryHistory(), routes });
    await mem.push("/mobile");
    expect(mem.currentRoute.value.name).toBe("mobileTerminals");
  });

  it("emits base-prefixed hrefs when mounted under a base path", () => {
    const mem = createRouter({ history: createMemoryHistory("/mulmoterminal/"), routes });
    expect(mem.resolve({ name: "mobileTerminals" }).href).toBe("/mulmoterminal/mobile/terminals");
  });

  it("opens the grid at the root", async () => {
    const mem = createRouter({ history: createMemoryHistory(), routes });
    await mem.push("/");
    expect(mem.currentRoute.value.name).toBe("terminals");
  });

  it("redirects removed or unknown paths through the root", async () => {
    const mem = createRouter({ history: createMemoryHistory(), routes });
    await mem.push("/collections/todos");
    expect(mem.currentRoute.value.name).toBe("terminals");
    await mem.push("/prs");
    expect(mem.currentRoute.value.name).toBe("terminals");
    await mem.push("/this/does/not/exist");
    expect(mem.currentRoute.value.name).toBe("terminals");
  });
});
