// @vitest-environment node
// Every mulmoterminal on the machine writes ONE ~/.mulmoterminal/config.json. A build that does
// not know a key must hand it back untouched when it saves, or it deletes a setting the user made
// in a newer build — which is how `copyOnSelect` disappeared seconds after being set, silently
// (#966). These pin the carry-through: the load side collects what it doesn't recognise, and the
// write side puts it back.
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import express from "express";
import request from "supertest";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  unknownConfigKeys,
  unknownKeysOf,
  serializableAppConfig,
  loadAppConfigResult,
  saveAppConfig,
  mergeConfigUpdate,
  emptyConfig,
} from "../../../server/config/app-config";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-unknown-cfg-"));
const withDir = (run: (file: string) => void) => {
  const dir = tmp();
  try {
    run(path.join(dir, "config.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("unknownConfigKeys", () => {
  it("collects the top-level keys this version does not know", () => {
    expect(unknownConfigKeys({ copyOnSelect: true, futureFeature: "on", anotherOne: 3 })).toEqual({ futureFeature: "on", anotherOne: 3 });
  });

  it("keeps its hands off every key this version DOES know", () => {
    const known = emptyConfig();
    expect(unknownConfigKeys(known)).toEqual({});
    // The known set is derived from emptyConfig(), so this is what proves a newly added field
    // never starts life classified as unknown.
    Object.keys(known).forEach((key) => expect(unknownConfigKeys({ [key]: "whatever" }), key).toEqual({}));
  });

  it("preserves the value verbatim, nesting and all", () => {
    const nested = { deep: { list: [1, { a: null }], when: "2026-07-28" } };
    expect(unknownConfigKeys({ futureFeature: nested }).futureFeature).toEqual(nested);
  });

  // A config key is just a JSON name. These three answer `in` through Object.prototype, so a
  // membership test written with `in` instead of hasOwn would drop them as fake collisions.
  it.each(["toString", "constructor", "__proto__"])("treats %s as an ordinary key, not the prototype", (key) => {
    const raw: Record<string, unknown> = JSON.parse(`{ "${key}": "mine" }`);
    expect(unknownConfigKeys(raw)[key]).toBe("mine");
  });

  it("has nothing to collect from a non-object file", () => {
    [null, undefined, 42, "text", [1, 2]].forEach((raw) => expect(unknownConfigKeys(raw)).toEqual({}));
  });
});

describe("serializableAppConfig", () => {
  it("appends the unknown keys after this version's fields", () => {
    const out = serializableAppConfig(emptyConfig(), { futureFeature: "on" });
    expect(out.futureFeature).toBe("on");
    expect(Object.keys(out).at(-1)).toBe("futureFeature");
  });

  // Can't happen from a real load (a known name is never collected as unknown), so this is a
  // guard on the merge itself: the running version's value is the one that must survive.
  it("never lets an unknown key overwrite a known field", () => {
    const config = { ...emptyConfig(), copyOnSelect: true };
    expect(serializableAppConfig(config, { copyOnSelect: false }).copyOnSelect).toBe(true);
  });

  // `__proto__` is a setter on Object.prototype, so building the output with `out[key] = value`
  // re-parents the object instead of adding a property — the key then vanishes from the JSON,
  // which is exactly the deletion this whole change exists to stop (found by Codex review).
  it("keeps a key named __proto__ as data, and does not re-parent the object", () => {
    const unknown: Record<string, unknown> = JSON.parse('{ "__proto__": { "polluted": true } }');
    const out = serializableAppConfig(emptyConfig(), unknown);
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(out, "__proto__")?.value).toEqual({ polluted: true });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(JSON.stringify(out)).toContain('"__proto__"');
  });

  it("round-trips a __proto__ key through the file", () => {
    withDir((file) => {
      writeFileSync(file, '{ "__proto__": { "mode": "fast" } }');
      const loaded = loadAppConfigResult(file);
      expect(saveAppConfig(file, emptyConfig(), unknownKeysOf(loaded))).toBe(true);
      const reread: Record<string, unknown> = JSON.parse(readFileSync(file, "utf8"));
      expect(Object.getOwnPropertyDescriptor(reread, "__proto__")?.value).toEqual({ mode: "fast" });
    });
  });

  it("writes exactly today's shape when there is nothing unknown", () => {
    expect(serializableAppConfig(emptyConfig(), {})).toEqual({ ...emptyConfig() });
  });
});

describe("carrying unknown keys through a save (#966)", () => {
  it("keeps a newer version's key when this one rewrites the file", () => {
    withDir((file) => {
      // What a newer build left behind, next to fields this one understands.
      writeFileSync(file, JSON.stringify({ copyOnSelect: true, futureFeature: { mode: "fast" }, prRepos: ["o/r"] }, null, 2));

      const loaded = loadAppConfigResult(file);
      expect(loaded.status).toBe("ok");
      const base = loaded.status === "ok" ? loaded.config : emptyConfig();
      // A save this old build would do — e.g. recording a cwd preset.
      const next = mergeConfigUpdate(base, { cwdPresets: [{ label: "x", path: "/x" }] });
      expect(saveAppConfig(file, next, unknownKeysOf(loaded))).toBe(true);

      const onDisk = JSON.parse(readFileSync(file, "utf8"));
      expect(onDisk.futureFeature).toEqual({ mode: "fast" }); // the whole point
      expect(onDisk.prRepos).toEqual(["o/r"]); // and the known fields still round-trip
      expect(onDisk.cwdPresets).toEqual([{ label: "x", path: "/x" }]);
    });
  });

  it("survives repeated saves rather than surviving only the first", () => {
    withDir((file) => {
      writeFileSync(file, JSON.stringify({ futureFeature: "on" }));
      for (let i = 0; i < 3; i += 1) {
        const loaded = loadAppConfigResult(file);
        const base = loaded.status === "ok" ? loaded.config : emptyConfig();
        saveAppConfig(file, mergeConfigUpdate(base, { pushEnabled: i % 2 === 0 }), unknownKeysOf(loaded));
      }
      expect(JSON.parse(readFileSync(file, "utf8")).futureFeature).toBe("on");
    });
  });

  it("has nothing to carry from a missing or corrupt file", () => {
    withDir((file) => {
      expect(unknownKeysOf({ status: "missing" })).toEqual({});
      expect(unknownKeysOf({ status: "corrupt", error: "boom" })).toEqual({});
      writeFileSync(file, "{ not json");
      expect(unknownKeysOf(loadAppConfigResult(file))).toEqual({});
    });
  });
});

// The route is where the bug was reported from: the settings modal saves, and another version's
// key is gone. Driving the real handler proves the wiring carries the keys, not just the helpers.
describe("POST /api/config", () => {
  it("keeps an unknown key that was already in the file", async () => {
    const dir = tmp();
    try {
      vi.stubEnv("HOME", dir);
      vi.resetModules();
      const { mountConfigRoutes, APP_CONFIG_FILE } = await import("../../../server/config/config-routes.js");
      // Guard before anything writes: a stub that didn't take would target the real config.
      expect(APP_CONFIG_FILE.startsWith(dir), "config path must be inside the temp HOME").toBe(true);

      mkdirSync(path.dirname(APP_CONFIG_FILE), { recursive: true });
      writeFileSync(APP_CONFIG_FILE, JSON.stringify({ futureFeature: "on", prRepos: ["o/r"] }, null, 2));

      const app = express();
      app.use(express.json());
      mountConfigRoutes(app, dir);
      const res = await request(app).post("/api/config").send({ pushEnabled: true });
      expect(res.status).toBe(200);

      const onDisk = JSON.parse(readFileSync(APP_CONFIG_FILE, "utf8"));
      expect(onDisk.futureFeature).toBe("on");
      expect(onDisk.pushEnabled).toBe(true);
      expect(onDisk.prRepos).toEqual(["o/r"]);
      // The response stays this version's view — an unknown key means nothing to the UI.
      expect(res.body.futureFeature).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
