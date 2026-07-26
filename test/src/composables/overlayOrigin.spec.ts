import { describe, it, expect, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { router } from "../../../src/router/index";
import { prsGotoIndex, prsClose } from "../../../src/composables/usePrsView";
import { accountingViewOpen, accountingViewClose } from "../../../src/composables/useAccountingView";
import { wikiGotoIndex, wikiGotoPage, wikiGotoGraph, wikiClose } from "../../../src/composables/useWikiBrowse";
import { browseGotoIndex, browseGotoDetail, browseClose } from "../../../src/composables/useCollectionBrowse";

// Drives the real singleton router (jsdom web-history) — the composables are bound to it.
const settle = () => flushPromises();

// Every full-screen overlay, as (name, open, close). Same contract for all of them, so the
// cases below are one table rather than four near-identical blocks (#886).
const OVERLAYS = [
  ["PRs", () => prsGotoIndex(), () => prsClose(), "prs"],
  ["accounting", () => accountingViewOpen(), () => accountingViewClose(), "accounting"],
  ["wiki", () => wikiGotoIndex(), () => wikiClose(), "wiki"],
  ["collections", () => browseGotoIndex("collection"), () => browseClose(), "collections"],
] as const;

describe("overlay return-to-origin", () => {
  beforeEach(async () => {
    await router.push({ name: "chat" });
    await settle();
  });

  it.each(OVERLAYS)("%s: opened from the grid, closes back to the grid", async (_name, open, close, routeName) => {
    await router.push("/terminals");
    await settle();

    open();
    await settle();
    expect(router.currentRoute.value.name).toBe(routeName);

    close();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  it.each(OVERLAYS)("%s: opened from the single view, closes back to it", async (_name, open, close, routeName) => {
    open();
    await settle();
    expect(router.currentRoute.value.name).toBe(routeName);

    close();
    await settle();
    expect(router.currentRoute.value.name).toBe("chat");
  });

  // A direct load / a history-driven entry carries no origin. Chat is the fallback, NOT the
  // literal "/" — that path is the default-view entry and would land on the grid (#883).
  it.each(OVERLAYS)("%s: falls back to chat when the entry carries no origin", async (_name, _open, close, routeName) => {
    await router.push(`/${routeName === "collections" ? "collections" : routeName}`);
    await settle();

    close();
    await settle();
    expect(router.currentRoute.value.name).toBe("chat");
  });

  // Moving around INSIDE an overlay must not re-record the origin as the overlay itself,
  // or closing from a sub-page would return to the page you just left.
  it("wiki: keeps the origin across its own tabs", async () => {
    await router.push("/terminals");
    await settle();

    wikiGotoIndex();
    await settle();
    wikiGotoPage("alpha");
    await settle();
    wikiGotoGraph();
    await settle();
    expect(router.currentRoute.value.name).toBe("wikiGraph");

    wikiClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  it("collections: keeps the origin from index to detail", async () => {
    await router.push("/terminals");
    await settle();

    browseGotoIndex("collection");
    await settle();
    browseGotoDetail("collection", "todos");
    await settle();
    expect(router.currentRoute.value.name).toBe("collectionDetail");

    browseClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  // Hopping straight from one overlay to another (grid → PRs → Worklog) must keep the view
  // UNDERNEATH as the return target. Recording the previous overlay instead is what made the
  // header follow Worklog back to the single view (#889) — and only a real click-through
  // found it, because every earlier case opened exactly one overlay.
  it("carries the underlying view across an overlay-to-overlay hop", async () => {
    await router.push("/terminals");
    await settle();

    prsGotoIndex();
    await settle();
    wikiGotoIndex();
    await settle();
    expect(router.currentRoute.value.name).toBe("wiki");

    wikiClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  it("carries the single view across an overlay-to-overlay hop", async () => {
    browseGotoIndex("collection");
    await settle();
    accountingViewOpen();
    await settle();

    accountingViewClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("chat");
  });
});
