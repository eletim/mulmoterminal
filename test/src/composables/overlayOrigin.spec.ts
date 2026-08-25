import { describe, it, expect, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { router } from "../../../src/router/index";
import { filesGotoIndex, filesClose } from "../../../src/composables/useFilesView";

const settle = () => flushPromises();

describe("overlay return-to-origin", () => {
  beforeEach(async () => {
    await router.push("/terminals");
    await settle();
  });

  it("files: opened from the grid, closes back to the grid", async () => {
    filesGotoIndex("/repo");
    await settle();
    expect(router.currentRoute.value.name).toBe("files");

    filesClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  it("files: falls back to the grid when the entry carries no origin", async () => {
    await router.push("/files");
    await settle();

    filesClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });
});
