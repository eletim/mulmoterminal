import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import DirBadge from "../../../src/components/DirBadge.vue";
import LauncherCell from "../../../src/components/LauncherCell.vue";
import CommandCell from "../../../src/components/CommandCell.vue";
import TerminalCell from "../../../src/components/TerminalCell.vue";

// `dirBadge.spec.ts` next to this one covers badgeStyleFor (the contrast maths). This file covers
// the COMPONENT and, more importantly, that all three grid cells actually render it.

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

vi.mock("../../../src/components/Terminal.vue", () => ({
  default: { name: "TerminalView", props: ["sessionId", "connectKey", "cwd", "launcher", "command", "hideHeader"], template: "<div />" },
}));

function serveDirConfig(dirConfig: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/dir-config")) return { ok: true, json: async () => dirConfig };
    if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/x", scripts: [] }) };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
}

describe("DirBadge", () => {
  it("renders the name, and nothing at all without one", () => {
    expect(mount(DirBadge, { props: { name: "PROD", color: "#cf222e" } }).text()).toBe("PROD");
    // `v-if`, not an empty span: an unnamed directory must not leave a gap in the header row.
    expect(mount(DirBadge, { props: { name: null, color: null } }).html()).toBe("<!--v-if-->");
    expect(mount(DirBadge, { props: { name: "", color: null } }).html()).toBe("<!--v-if-->");
  });

  // The background is the directory's; the TEXT colour is derived for contrast — the part a
  // hand-written fourth copy of this badge would most likely have dropped.
  it("uses the directory's colour with a readable text colour on top", () => {
    const style = mount(DirBadge, { props: { name: "P", color: "#190a23" } }).attributes("style");
    expect(style).toContain("background: rgb(25, 10, 35)");
    expect(style).toContain("color: rgb(255, 255, 255)");
  });
});

// The point of #914. The badge is how a user tells parallel projects apart, and it appeared on
// Claude cells only — a shell cell in the same directory showed nothing. That also made #902 hard
// to read, since a missing badge looks exactly like a missing config.
describe("every grid cell shows the directory's badge", () => {
  const DIR = { name: "PROD", badgeColor: "#cf222e" };

  it("LauncherCell", async () => {
    serveDirConfig(DIR);
    const w = mount(LauncherCell, {
      props: {
        uid: 1,
        active: false,
        expanded: false,
        zoomed: false,
        launcher: { shell: true, label: "Shell" },
        session: null,
        cwd: "/proj/badge-launcher",
        home: "/home/me",
      },
    });
    await flushPromises();
    expect(w.findComponent(DirBadge).text()).toBe("PROD");
    w.unmount();
  });

  it("CommandCell", async () => {
    serveDirConfig(DIR);
    const w = mount(CommandCell, {
      props: {
        uid: 2,
        active: false,
        expanded: false,
        zoomed: false,
        command: { source: "script" as const, index: 0, label: "build", cwd: "/proj/badge-command" },
        home: "/home/me",
      },
    });
    await flushPromises();
    expect(w.findComponent(DirBadge).text()).toBe("PROD");
    w.unmount();
  });

  it("TerminalCell", async () => {
    serveDirConfig(DIR);
    const w = mount(TerminalCell, {
      props: {
        uid: 3,
        active: false,
        expanded: false,
        zoomed: false,
        initialSessionId: "11111111-1111-1111-1111-111111111111",
        initialCwd: "/proj/badge-terminal",
        defaultCwd: "/proj/badge-terminal",
        presets: [],
        home: "/home/me",
        cancellable: false,
        openSessionIds: [],
        openCwds: [],
      },
    });
    await flushPromises();
    expect(w.findComponent(DirBadge).text()).toBe("PROD");
    w.unmount();
  });
});
