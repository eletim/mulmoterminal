import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AppToolbar from "../../../src/components/AppToolbar.vue";
import { router } from "../../../src/router/index";

const settle = () => flushPromises();

const labelsOf = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper
    .findAll("nav[aria-label='Views'] button")
    .map((b) => b.attributes("aria-label") ?? b.attributes("title") ?? "")
    .filter(Boolean);

const mountAt = async (path: string) => {
  await router.push(path);
  await settle();
  const wrapper = mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true } } });
  await settle();
  return wrapper;
};

describe("AppToolbar per-view buttons", () => {
  beforeEach(async () => {
    await router.push("/terminals");
    await settle();
  });

  it("offers only Grid and Files as view switches", async () => {
    const labels = labelsOf(await mountAt("/terminals"));
    expect(labels).toEqual(expect.arrayContaining(["Grid view", "Files"]));
    expect(labels).not.toEqual(expect.arrayContaining(["Collections", "Feeds", "Wiki", "Accounting", "Pull requests", "Worklog"]));
  });

  it("offers the grid-running controls on the grid", async () => {
    const labels = labelsOf(await mountAt("/terminals"));
    expect(labels).toContain("New terminal");
    expect(labels.some((label) => label.startsWith("Grid cell ordering:"))).toBe(true);
  });

  it("renders the desktop Mobile QR toolbar control without displacing Settings", async () => {
    const wrapper = await mountAt("/terminals");
    expect(wrapper.find('button[aria-label="Mobile QR code"]').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="Settings"]').exists()).toBe(true);
  });

  it("hides the grid's own controls while Files covers the grid", async () => {
    const labels = labelsOf(await mountAt("/files"));
    expect(labels).not.toContain("New terminal");
    expect(labels.some((label) => label.startsWith("Grid cell ordering:"))).toBe(false);
    expect(labels).toContain("Grid view");
  });

  it("highlights the active view", async () => {
    const activeLabels = (wrapper: ReturnType<typeof mount>): string[] =>
      wrapper
        .findAll("nav[aria-label='Views'] button")
        .filter((b) => b.classes().includes("bg-accent-bg"))
        .map((b) => b.attributes("aria-label") ?? b.attributes("title") ?? "");

    expect(activeLabels(await mountAt("/terminals"))).toEqual(["Grid view"]);
    expect(activeLabels(await mountAt("/files"))).toEqual(["Files"]);
  });
});

describe("AppToolbar view-switch grouping", () => {
  const switchGroup = (wrapper: ReturnType<typeof mount>) => wrapper.find("nav[aria-label='Views'] [role='group'][aria-label='Switch view']");

  it("groups the two view switches that remain", async () => {
    const group = switchGroup(await mountAt("/terminals"));
    expect(group.exists()).toBe(true);
    expect(group.findAll("button").map((b) => b.attributes("aria-label"))).toEqual(["Grid view", "Files"]);
  });

  it("carries the separating rule", async () => {
    expect(switchGroup(await mountAt("/terminals")).classes()).toContain("border-r");
  });
});
