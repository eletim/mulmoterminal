import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AppToolbar from "../../../src/components/AppToolbar.vue";
import { router } from "../../../src/router/index";
import { prsGotoIndex } from "../../../src/composables/usePrsView";
import { browseGotoIndex } from "../../../src/composables/useCollectionBrowse";

// The toolbar is ONE component rendered by both views (GridView and App), so which buttons
// it offers is decided by the route, not by a prop (#886).
const settle = () => flushPromises();

const labelsOf = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper
    .findAll("nav[aria-label='Views'] button")
    .map((b) => b.attributes("aria-label") ?? b.attributes("title") ?? "")
    .filter(Boolean);

const mountAt = async (path: string) => {
  await router.push(path);
  await settle();
  const wrapper = mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } });
  await settle();
  return wrapper;
};

describe("AppToolbar per-view buttons", () => {
  beforeEach(async () => {
    await router.push({ name: "chat" });
    await settle();
  });

  it("offers the content surfaces in the single view", async () => {
    const labels = labelsOf(await mountAt("/chat"));
    expect(labels).toEqual(expect.arrayContaining(["Chat", "Grid view", "Collections", "Accounting", "Wiki"]));
  });

  it("hides the content surfaces in the grid", async () => {
    const labels = labelsOf(await mountAt("/terminals"));
    expect(labels).not.toContain("Collections");
    expect(labels).not.toContain("Accounting");
    expect(labels).not.toContain("Wiki");
  });

  // Both views keep the pair that switches between them — hiding either would strand a user
  // in whichever view they were in.
  it("keeps the view switch in both views", async () => {
    expect(labelsOf(await mountAt("/chat"))).toEqual(expect.arrayContaining(["Chat", "Grid view"]));
    expect(labelsOf(await mountAt("/terminals"))).toEqual(expect.arrayContaining(["Chat", "Grid view"]));
  });

  // The two reference surfaces you consult WHILE supervising, so they sit in the grid's own
  // nav rather than the single view's content cluster.
  it.each(["Pull requests", "Worklog"])("offers %s only in the grid", async (label) => {
    expect(labelsOf(await mountAt("/terminals"))).toContain(label);
    expect(labelsOf(await mountAt("/chat"))).not.toContain(label);
  });

  it("offers the grid-running controls only in the grid", async () => {
    const grid = labelsOf(await mountAt("/terminals"));
    expect(grid).toContain("New terminal");
    expect(grid).toContain("Toggle grid cell ordering");
    const single = labelsOf(await mountAt("/chat"));
    expect(single).not.toContain("New terminal");
    expect(single).not.toContain("Toggle grid cell ordering");
  });

  // The overlays render BELOW the header (`top-10`), so the header stays on screen while one
  // is open. Switching to the other view's buttons there would take away the very button the
  // user just clicked — and would swap the shell behind the panel (#889).
  it("keeps the grid buttons while an overlay opened FROM the grid is on screen", async () => {
    await router.push("/terminals");
    await settle();
    prsGotoIndex();
    await settle();

    const labels = labelsOf(mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } }));
    expect(labels).toContain("Pull requests");
    expect(labels).toContain("Worklog");
    expect(labels).not.toContain("Collections");
  });

  it("keeps the single-view buttons while an overlay opened from the single view is on screen", async () => {
    await router.push({ name: "chat" });
    await settle();
    browseGotoIndex("collection");
    await settle();

    const labels = labelsOf(mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } }));
    expect(labels).toContain("Collections");
    expect(labels).not.toContain("Pull requests");
  });

  // Regression: the button SET follows the view underneath, but the HIGHLIGHT follows the
  // route. Answering both with one flag lit up Grid view AND Pull requests at once — and,
  // because the overlays live inside App.vue's `!isGrid` block, also stopped the panel
  // rendering at all: the URL changed and the grid just stayed on screen (#889).
  const activeLabels = (wrapper: ReturnType<typeof mount>): string[] =>
    wrapper
      .findAll("nav[aria-label='Views'] button")
      .filter((b) => b.classes().includes("bg-accent-bg"))
      .map((b) => b.attributes("aria-label") ?? b.attributes("title") ?? "");

  it("highlights exactly one view, even with a grid-opened overlay on screen", async () => {
    await router.push("/terminals");
    await settle();
    const onGrid = mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } });
    expect(activeLabels(onGrid)).toEqual(["Grid view"]);

    prsGotoIndex();
    await settle();
    const onPrs = mount(AppToolbar, { global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostControl: true } } });
    expect(activeLabels(onPrs)).toEqual(["Pull requests"]);
  });
});
