import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LauncherCell from "../../../src/components/LauncherCell.vue";
import CommandCell from "../../../src/components/CommandCell.vue";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

// Declares the dir-* props so the test sees what each cell actually hands its terminal. These two
// cells passed NONE of them before #902, so a directory's theme/font applied to Claude cells and
// the single view but silently not here.
let seen: Record<string, unknown> | null = null;
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "launcher", "command", "dirTheme", "dirColors", "dirFontSize", "dirFontFamily"],
    created() {
      seen = (this as unknown as { $props: Record<string, unknown> }).$props;
    },
    template: "<div />",
  },
}));

// Reset through a function: assigning `seen = null` inline narrows it to `null` for the rest of the
// test, and the mock factory's write back is invisible to control-flow analysis.
function forgetSeen(): void {
  seen = null;
}

// A distinct directory per test — useDirConfig caches per cwd at module level.
const DIR_LAUNCHER = "/proj/launcher-dir-font";
const DIR_COMMAND = "/proj/command-dir-font";

function serve(dirConfig: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes("/api/dir-config")) return { ok: true, json: async () => dirConfig };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

const DIR_CONFIG = { name: "THEMED", theme: "nord", fontSize: 20, fontFamily: "Songti SC, monospace" };

describe("LauncherCell passes the directory's terminal look down (#902)", () => {
  it("adopts the directory's theme, size and font family", async () => {
    forgetSeen();
    serve(DIR_CONFIG);
    const w = mount(LauncherCell, {
      props: {
        uid: 1,
        expanded: false,
        zoomed: false,
        launcher: { shell: true, label: "Shell" },
        session: null,
        cwd: DIR_LAUNCHER,
        home: "/home/me",
      },
    });
    await flushPromises();

    expect(seen?.dirTheme).toBe("nord");
    expect(seen?.dirFontSize).toBe(20);
    expect(seen?.dirFontFamily).toBe("Songti SC, monospace");
    w.unmount();
  });
});

describe("CommandCell passes the directory's terminal look down (#902)", () => {
  // The cwd lives inside the `command` object here, not as a top-level prop — the one thing that
  // differs from LauncherCell, and the reason this reads through a getter ref.
  it("resolves the config from command.cwd", async () => {
    forgetSeen();
    serve(DIR_CONFIG);
    const w = mount(CommandCell, {
      props: {
        uid: 2,
        expanded: false,
        zoomed: false,
        command: { source: "script" as const, index: 0, label: "build", cwd: DIR_COMMAND },
        home: "/home/me",
      },
    });
    await flushPromises();

    expect(seen?.dirTheme).toBe("nord");
    expect(seen?.dirFontSize).toBe(20);
    expect(seen?.dirFontFamily).toBe("Songti SC, monospace");
    w.unmount();
  });
});
