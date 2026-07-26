import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// The grid subscribes to the pub/sub socket on mount — stub it so no real socket opens.
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

// Session ids for the roster-ordering test (must be valid UUIDs or parseGridState drops them).
const IDS = vi.hoisted(() => ({
  blocked: "11111111-1111-1111-1111-111111111111",
  idleA: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  idleB: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
}));
// Feed one blocked session so the auto sort has something to float to the front.
vi.mock("../../../src/composables/useGridActivity", () => ({
  useGridActivity: () => ({ activity: new Map([[IDS.blocked, { working: false, waiting: true, event: "Notification" }]]) }),
}));

// Config GET hydrates pushEnabled=true; capture POSTs so we can assert the toggle saves.
const posts: Array<{ url: string; body: unknown }> = [];
beforeEach(() => {
  posts.length = 0;
  localStorage.clear();
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/config")) {
      if (init?.method === "POST") posts.push({ url: u, body: init.body });
      return {
        ok: true,
        json: async () => ({
          cwd: "/w",
          home: "/w",
          cwdPresets: [],
          soundFile: null,
          pushEnabled: true,
          prRepos: [],
          launchers: [],
          userMcpServers: [],
          buttons: null,
          chips: null,
        }),
      } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }) as typeof fetch;
});

// A SettingsModal stub whose props we can inspect + whose emits we can drive.
const SettingsStub = {
  name: "SettingsModal",
  props: ["soundFile", "pushEnabled", "prRepos", "launchers", "userMcpServers", "cwd", "sessionId"],
  emits: ["update-push-enabled", "close"],
  template: '<div class="settings-stub" />',
};
// A toolbar stub that lets us open the settings modal (GridView: @settings="showSettings = true").
const ToolbarStub = { name: "AppToolbar", emits: ["settings"], template: '<button class="open-settings" @click="$emit(\'settings\')" />' };

const mountGrid = async () => {
  const w = mount((await import("../../../src/components/GridView.vue")).default, {
    global: { stubs: { TerminalGrid: true, AppToolbar: ToolbarStub, SettingsModal: SettingsStub } },
  });
  await flushPromises(); // onMounted loadConfig
  return w;
};

// A TerminalGrid stub that exposes the ordering props the roster/grid receive.
const OrderStub = {
  name: "TerminalGrid",
  props: ["cells", "listRows", "expandedUid", "reorderable"],
  template: '<div class="order-stub" />',
};

describe("GridView roster ordering (#720)", () => {
  it("orders the cockpit roster (listRows) attention-first in auto mode, matching the grid", async () => {
    // Auto sort, one cell zoomed (roster visible); the middle cell (uid→1) is the blocked one.
    localStorage.setItem(
      "grid_v2",
      JSON.stringify({
        cells: [
          { uid: 10, session: IDS.idleA, cwd: "/w" },
          { uid: 11, session: IDS.blocked, cwd: "/w" },
          { uid: 12, session: IDS.idleB, cwd: "/w" },
        ],
        expanded: 10,
        page: 0,
        sortMode: "auto",
      }),
    );
    const w = mount((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: OrderStub, AppToolbar: ToolbarStub, SettingsModal: SettingsStub } },
    });
    await flushPromises();
    const grid = w.findComponent(OrderStub);
    // The blocked cell (renumbered uid 1) floats to the top; the two idle cells keep manual order.
    const rosterOrder = grid.props("listRows").map((r: { uid: number }) => r.uid);
    expect(rosterOrder).toEqual([1, 0, 2]);
    // The grid reads the SAME ordering — roster and grid can't drift.
    expect(grid.props("cells").map((c: { uid: number }) => c.uid)).toEqual([1, 0, 2]);
    w.unmount();
  });
});

// A toolbar stub that surfaces the view-toggle props and can fire the toggle-view event, plus a
// TerminalGrid stub exposing the listMode prop — together they trace the header → GridView → grid
// wiring for the roster ⇄ strip toggle.
const ViewToggleToolbarStub = {
  name: "AppToolbar",
  props: ["showViewToggle", "listMode"],
  emits: ["toggle-view"],
  template: '<button class="toggle-view" @click="$emit(\'toggle-view\')" />',
};
const ListModeGridStub = { name: "TerminalGrid", props: ["listMode", "expandedUid"], template: '<div class="lm-stub" />' };

describe("GridView view toggle wiring", () => {
  it("shows the toggle only while zoomed and flips the grid's listMode when the header fires toggle-view", async () => {
    localStorage.setItem("grid_v2", JSON.stringify({ cells: [{ uid: 10, session: IDS.idleA, cwd: "/w" }], expanded: 10, page: 0, sortMode: "manual" }));
    const w = mount((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: ListModeGridStub, AppToolbar: ViewToggleToolbarStub, SettingsModal: SettingsStub } },
    });
    await flushPromises();
    const toolbar = w.findComponent(ViewToggleToolbarStub);
    const grid = w.findComponent(ListModeGridStub);
    // A cell is expanded → the toggle is offered, and both surfaces start in roster (list) mode.
    expect(toolbar.props("showViewToggle")).toBe(true);
    expect(toolbar.props("listMode")).toBe(true);
    expect(grid.props("listMode")).toBe(true);
    // The header toggle flips roster → strip for the grid too.
    await toolbar.trigger("click");
    expect(grid.props("listMode")).toBe(false);
    expect(toolbar.props("listMode")).toBe(false);
    w.unmount();
  });

  it("hides the toggle when nothing is expanded", async () => {
    localStorage.setItem("grid_v2", JSON.stringify({ cells: [{ uid: 10, session: IDS.idleA, cwd: "/w" }], expanded: null, page: 0, sortMode: "manual" }));
    const w = mount((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: ListModeGridStub, AppToolbar: ViewToggleToolbarStub, SettingsModal: SettingsStub } },
    });
    await flushPromises();
    expect(w.findComponent(ViewToggleToolbarStub).props("showViewToggle")).toBe(false);
    w.unmount();
  });
});

describe("GridView guide help (empty state)", () => {
  it("shows the guide footer (ja/en links) when no terminal is running, and hides it once one is", async () => {
    // Empty grid: ensureEntry leaves only the entry launch cell, so runningCount === 0.
    const empty = await mountGrid();
    const footer = empty.find("footer");
    expect(footer.exists()).toBe(true);
    const hrefs = footer.findAll("a").map((a) => a.attributes("href"));
    expect(hrefs).toContain("https://receptron.github.io/mulmoterminal/guide/ja/");
    expect(hrefs).toContain("https://receptron.github.io/mulmoterminal/guide/en/");
    empty.unmount();

    // A running session cell (occupied) — the newcomer hint must step out of the way.
    localStorage.setItem("grid_v2", JSON.stringify({ cells: [{ uid: 1, session: IDS.idleA, cwd: "/w" }], expanded: null, page: 0, sortMode: "manual" }));
    const running = mount((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: true, AppToolbar: ToolbarStub, SettingsModal: SettingsStub } },
    });
    await flushPromises();
    expect(running.find("footer").exists()).toBe(false);
    running.unmount();
  });
});

describe("GridView settings wiring", () => {
  it("passes pushEnabled to SettingsModal and saves it on update-push-enabled (regression #347)", async () => {
    const w = await mountGrid();
    await w.find(".open-settings").trigger("click"); // open the settings modal
    const modal = w.findComponent(SettingsStub);
    expect(modal.exists()).toBe(true);
    // The grid view must reflect the saved config, not a default false.
    expect(modal.props("pushEnabled")).toBe(true);

    // Toggling in the grid view must persist via POST /api/config.
    modal.vm.$emit("update-push-enabled", false);
    await flushPromises();
    const pushPost = posts.find((p) => String(p.body).includes("pushEnabled"));
    expect(pushPost, "toggling push should POST /api/config").toBeTruthy();
    expect(String(pushPost?.body)).toContain('"pushEnabled":false');
  });
});

// --- Keyboard shortcut wiring (#829) -------------------------------------------------
//
// The pure transforms are covered in gridTabs.spec.ts. What is covered HERE is the wiring
// GridView owns, which is where every bug in this feature actually lived: which ordered list
// the shortcuts are given, which cell the cursor is moved to, and whether a key that should
// only move ends up changing the layout.

// Focus calls land here instead of a real xterm.
const focused = vi.hoisted(() => [] as string[]);
vi.mock("../../../src/composables/useTerminalConnections", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  focus: (key: string) => focused.push(key),
}));

import { setActiveKeymap } from "../../../src/composables/activeKeymap";
import { PAGE_SIZE } from "../../../src/components/gridTabs";

const uuid = (n: number) => `${String(n % 10).repeat(8)}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;

// A TerminalGrid stub that reports the props the shortcuts drive, and can raise focus-cell the
// way the real grid does when a terminal takes the cursor.
const ShortcutGridStub = {
  name: "TerminalGrid",
  props: ["cells", "listRows", "expandedUid", "reorderable"],
  emits: ["focus-cell"],
  template: '<div class="shortcut-stub" />',
};

const press = async (key: string) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  await flushPromises();
};

const DEFAULT_KEYMAP = { "zoom-toggle": "F8", "next-attention": "F9", "zoom-next": "PageDown", "zoom-prev": "PageUp" };

/** Mount a grid of `count` running cells, all on the first page unless `page` says otherwise.
 *  The keymap is applied AFTER mounting because GridView's onMounted loadConfig hydrates it
 *  from /api/config — setting it earlier would be overwritten by the stubbed response. */
const mountShortcutGrid = async (count: number, extra: Record<string, unknown> = {}, keymap: unknown = DEFAULT_KEYMAP) => {
  localStorage.setItem(
    "grid_v2",
    JSON.stringify({
      cells: Array.from({ length: count }, (_, i) => ({ uid: i, session: uuid(i), cwd: "/w" })),
      expanded: null,
      page: 0,
      sortMode: "manual",
      ...extra,
    }),
  );
  const w = mount((await import("../../../src/components/GridView.vue")).default, {
    global: { stubs: { TerminalGrid: ShortcutGridStub, AppToolbar: ToolbarStub, SettingsModal: SettingsStub } },
  });
  await flushPromises();
  setActiveKeymap(keymap);
  return w;
};

const gridOf = (w: ReturnType<typeof mount>) => w.findComponent(ShortcutGridStub);

describe("GridView keyboard shortcuts (#829)", () => {
  beforeEach(() => {
    focused.length = 0;
  });

  it("does nothing at all when no keymap is configured — shortcuts are opt-in", async () => {
    // `null`, not `undefined` — passing undefined to a defaulted parameter selects the default.
    const w = await mountShortcutGrid(4, {}, null);
    await press("F8");
    expect(gridOf(w).props("expandedUid")).toBeNull();
    expect(focused).toEqual([]);
    w.unmount();
  });

  it("F8 enlarges, and F8 again collapses", async () => {
    const w = await mountShortcutGrid(4);
    await press("F8");
    expect(gridOf(w).props("expandedUid")).not.toBeNull();
    await press("F8");
    expect(gridOf(w).props("expandedUid")).toBeNull();
    w.unmount();
  });

  it("F8 enlarges the FOCUSED terminal, not the first of the page", async () => {
    const w = await mountShortcutGrid(4);
    gridOf(w).vm.$emit("focus-cell", 2); // the cursor is in cell 2
    await flushPromises();
    await press("F8");
    expect(gridOf(w).props("expandedUid")).toBe(2);
    w.unmount();
  });

  it("keeps the cursor on the same terminal across enlarge and collapse", async () => {
    const w = await mountShortcutGrid(4);
    gridOf(w).vm.$emit("focus-cell", 2);
    await flushPromises();
    await press("F8");
    expect(focused.at(-1)).toBe("cell-2");
    await press("F8"); // collapse — the selection must stay on 2, not jump elsewhere
    expect(focused.at(-1)).toBe("cell-2");
    w.unmount();
  });

  // The bug that made F9 look dead: with no origin the rotation restarted every press.
  it("F9 advances through terminals instead of picking the same one every time", async () => {
    const w = await mountShortcutGrid(4);
    await press("F9");
    const first = focused.at(-1);
    // Report the focus back the way the real grid does, so the next press has an origin.
    gridOf(w).vm.$emit("focus-cell", Number(first?.replace("cell-", "")));
    await flushPromises();
    await press("F9");
    expect(focused.at(-1)).not.toBe(first);
    w.unmount();
  });

  it("F9 NEVER enlarges or collapses — only F8 changes that", async () => {
    const w = await mountShortcutGrid(4);
    await press("F9");
    expect(gridOf(w).props("expandedUid")).toBeNull(); // still a grid

    await press("F8"); // now zoomed
    const zoomed = gridOf(w).props("expandedUid");
    expect(zoomed).not.toBeNull();
    await press("F9");
    expect(gridOf(w).props("expandedUid")).not.toBeNull(); // still zoomed, just a different cell
    w.unmount();
  });

  // Regression: shortcuts used to be handed the visible page slice, so a cell calling from
  // another page was unreachable and the page maths were computed against the wrong origin.
  it("reaches a terminal on another page, and shows that page", async () => {
    const w = await mountShortcutGrid(PAGE_SIZE + 3, { page: 0 });
    gridOf(w).vm.$emit("focus-cell", PAGE_SIZE - 1); // last cell of page 0
    await flushPromises();
    await press("F9");
    // It moved onto a cell the first page does not contain...
    expect(focused.at(-1)).toBe(`cell-${PAGE_SIZE}`);
    // ...and that cell is now among the rendered ones.
    expect(
      gridOf(w)
        .props("cells")
        .map((c: { uid: number }) => c.uid),
    ).toContain(PAGE_SIZE);
    w.unmount();
  });

  it("PageDown/PageUp walk the enlarged terminal and stop at the ends", async () => {
    const w = await mountShortcutGrid(4);
    gridOf(w).vm.$emit("focus-cell", 0);
    await flushPromises();
    await press("F8");
    expect(gridOf(w).props("expandedUid")).toBe(0);
    await press("PageDown");
    expect(gridOf(w).props("expandedUid")).toBe(1);
    await press("PageUp");
    expect(gridOf(w).props("expandedUid")).toBe(0);
    await press("PageUp"); // already at the front — stays put
    expect(gridOf(w).props("expandedUid")).toBe(0);
    w.unmount();
  });

  it("leaves Shift+PageDown to the terminal when only the bare key is bound", async () => {
    const w = await mountShortcutGrid(4);
    await press("F8");
    const before = gridOf(w).props("expandedUid");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", shiftKey: true, bubbles: true }));
    await flushPromises();
    expect(gridOf(w).props("expandedUid")).toBe(before);
    w.unmount();
  });

  it("ignores an unbound key", async () => {
    const w = await mountShortcutGrid(4);
    await press("F7");
    expect(gridOf(w).props("expandedUid")).toBeNull();
    expect(focused).toEqual([]);
    w.unmount();
  });
});
