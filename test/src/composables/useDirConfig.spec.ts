import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref, effectScope, nextTick } from "vue";

// Capture the `dir-config` subscriber the composable registers, so a test can play the server.
let publish: ((data: unknown) => void) | null = null;
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (_channel: string, callback: (data: unknown) => void) => {
      publish = callback;
      return () => {};
    },
  }),
}));

import { useDirConfig, boundDirCount, invalidateDirConfig } from "../../../src/composables/useDirConfig";
import { TERMINAL_FONT_SIZE_MAX } from "../../../common/terminalFontSize";

let served = "first";
const flush = async () => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  served = "first";
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ name: served }) })),
  );
});

describe("useDirConfig fontSize", () => {
  const serve = (body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })),
    );
  const read = async (cwd: string) => {
    const scope = effectScope();
    const config = scope.run(() => useDirConfig(ref(cwd)).config);
    await flush();
    const size = config?.value.fontSize;
    scope.stop();
    return size;
  };

  it("adopts the size the directory pins", async () => {
    serve({ fontSize: 18 });
    expect(await read("/proj/font-pinned")).toBe(18);
  });

  // The server already clamps, but this parser is the trust boundary — an out-of-range size
  // that slipped through would otherwise reach the canvas renderer unchecked.
  it("re-clamps an out-of-range size off the wire", async () => {
    serve({ fontSize: 999 });
    expect(await read("/proj/font-clamped")).toBe(TERMINAL_FONT_SIZE_MAX);
  });

  it("stays null when the directory pins nothing, so the Settings value wins", async () => {
    serve({ name: "x" });
    expect(await read("/proj/font-absent")).toBeNull();
  });

  it("stays null for a non-numeric size rather than guessing", async () => {
    serve({ fontSize: "18" });
    expect(await read("/proj/font-garbage")).toBeNull();
  });
});

describe("useDirConfig live reload", () => {
  it("re-reads the directory when the server announces a change, without remounting", async () => {
    const scope = effectScope();
    const config = scope.run(() => useDirConfig(ref("/proj/a")).config);
    await flush();
    expect(config?.value.name).toBe("first");

    served = "second";
    publish?.({ cwd: "/proj/a" }); // the server saw a write to /proj/a/.mulmoterminal.json
    await flush();
    expect(config?.value.name).toBe("second");
    scope.stop();
  });

  // Each test uses its own directory: the per-cwd fetch cache is module-level and outlives a test.
  it("ignores an announcement for a directory nothing is showing", async () => {
    const scope = effectScope();
    const config = scope.run(() => useDirConfig(ref("/proj/b")).config);
    await flush();

    served = "second";
    publish?.({ cwd: "/proj/other" });
    await flush();
    expect(config?.value.name).toBe("first"); // untouched
    scope.stop();
  });

  it("unbinds on scope dispose and leaves no empty entry behind", async () => {
    const before = boundDirCount();
    const scope = effectScope();
    const config = scope.run(() => useDirConfig(ref("/proj/leaky")).config);
    await flush();
    expect(boundDirCount()).toBe(before + 1);

    scope.stop();
    expect(boundDirCount()).toBe(before); // the key is gone, not just the callback

    served = "second";
    invalidateDirConfig("/proj/leaky"); // a closed cell must not keep receiving updates
    await flush();
    expect(config?.value.name).toBe("first");
  });

  // Two writes in quick succession start overlapping requests; if the older response lands last it
  // must not overwrite the newer config.
  it("never lets a slow older response overwrite a newer one", async () => {
    const plan = [
      { name: "first", delay: 0 },
      { name: "older", delay: 60 },
      { name: "newer", delay: 5 },
    ];
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        const { name, delay } = plan[call++];
        return Promise.resolve({ ok: true, json: () => new Promise((r) => setTimeout(() => r({ name }), delay)) });
      }),
    );

    const scope = effectScope();
    const config = scope.run(() => useDirConfig(ref("/proj/race")).config);
    await flush();
    expect(config?.value.name).toBe("first");

    invalidateDirConfig("/proj/race"); // write A -> slow response "older"
    invalidateDirConfig("/proj/race"); // write B -> fast response "newer"
    await new Promise((r) => setTimeout(r, 120)); // let BOTH settle, slow one last

    expect(config?.value.name).toBe("newer");
    scope.stop();
  });

  it("seeds a re-mounted cell from cache so it never flashes the default palette", async () => {
    // First mount fetches and caches /proj/seed's config.
    const s1 = effectScope();
    const c1 = s1.run(() => useDirConfig(ref("/proj/seed")).config);
    await flush();
    expect(c1?.value.name).toBe("first");
    s1.stop();

    // A tab switch remounts the cell. The config must be present on the FIRST synchronous
    // frame — before any fetch/await settles — so the terminal paints the dir palette
    // immediately instead of the default one. (Pre-fix this was EMPTY until a flush.)
    const s2 = effectScope();
    const c2 = s2.run(() => useDirConfig(ref("/proj/seed")).config);
    expect(c2?.value.name).toBe("first"); // no flush
    s2.stop();
  });

  it("releases the old directory when a cell switches cwd", async () => {
    const before = boundDirCount();
    const cwd = ref("/proj/one");
    const scope = effectScope();
    scope.run(() => useDirConfig(cwd).config);
    await flush();
    expect(boundDirCount()).toBe(before + 1);

    cwd.value = "/proj/two";
    await flush();
    expect(boundDirCount()).toBe(before + 1); // one released, one acquired — not two

    scope.stop();
    expect(boundDirCount()).toBe(before);
  });
});
