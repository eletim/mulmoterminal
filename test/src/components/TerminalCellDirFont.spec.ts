import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TerminalCell from "../../../src/components/TerminalCell.vue";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: () => () => {},
    onReconnect: () => () => {},
  }),
}));

// A stub that DECLARES the dir-* props, so the test sees what the cell actually hands the
// terminal. The real Terminal.vue is what turns these into xterm options; the cell's job —
// and the only thing under test here — is to pass them down at all.
let seen: Record<string, unknown> | null = null;
// Reset through a function: assigning `seen = null` inline narrows it to `null` for the rest of
// the test, and the mock factory's write back is invisible to control-flow analysis.
function forgetSeen(): void {
  seen = null;
}
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "hideHeader", "dirTheme", "dirFontSize", "dirFontFamily"],
    created() {
      seen = (this as unknown as { $props: Record<string, unknown> }).$props;
    },
    template: "<div />",
    methods: { terminate() {}, submitText: () => true },
  },
}));

// A distinct directory per test: useDirConfig caches per cwd at module level, so a shared
// path would let the first test's config leak into the second.
const DIR_PINNED = "/proj/dir-font-pinned";
const DIR_PLAIN = "/proj/dir-font-plain";

function serve(dir: string, dirConfig: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/dir-config")) return { ok: true, json: async () => dirConfig };
    if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: dir, scripts: [] }) };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
}

function mountCell(dir: string) {
  return mount(TerminalCell, {
    props: {
      uid: 1,
      expanded: false,
      zoomed: false,
      initialSessionId: "11111111-1111-1111-1111-111111111111",
      initialCwd: dir,
      defaultCwd: dir,
      presets: [],
      home: "/home/me",
      cancellable: false,
      openSessionIds: [],
      openCwds: [],
    },
  });
}

describe("TerminalCell -> Terminal dir font wiring", () => {
  // The prop arrives ASYNCHRONOUSLY: useDirConfig has nothing cached on a fresh load, so the
  // terminal mounts with null and the value lands only once /api/dir-config resolves. That is
  // exactly why Terminal.vue watches it rather than reading it once at attach() time.
  it("passes the directory's fontFamily and fontSize down once the config resolves", async () => {
    forgetSeen();
    serve(DIR_PINNED, { name: "FONT-TEST", fontFamily: "Songti SC, monospace", fontSize: 20 });
    const w = mountCell(DIR_PINNED);
    await flushPromises();

    expect(seen).not.toBeNull();
    expect(seen?.dirFontFamily).toBe("Songti SC, monospace");
    expect(seen?.dirFontSize).toBe(20);
    w.unmount();
  });

  it("passes null when the directory pins no font, so the global values win", async () => {
    forgetSeen();
    serve(DIR_PLAIN, { name: "PLAIN" });
    const w = mountCell(DIR_PLAIN);
    await flushPromises();

    expect(seen?.dirFontFamily).toBeNull();
    expect(seen?.dirFontSize).toBeNull();
    w.unmount();
  });
});
