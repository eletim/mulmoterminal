// @vitest-environment node
// Firestore refuses `undefined` at any depth, and the runner writes a handler's reply straight
// into the command document — so one stray `undefined` costs the WHOLE reply, not one field. That
// is what emptied the phone's session list in #1042. These pin the guard that stands in front of
// the write, and the shape of the session list that tripped it.
import { describe, it, expect, vi } from "vitest";
import { undefinedPaths, stripUndefined, firestoreSafeHandlers, matchesPath } from "../../../server/backends/remoteHost/firestoreSafeResult";
import { buildSessionList } from "../../../server/backends/remoteHost/terminalScreen";

// A REAL hole, not `[1, undefined, 3]` — the two behave differently under map/flatMap, and the
// hole is the case that slipped through. Built rather than written as `[1, , 3]`, which the
// no-sparse-arrays lint rule forbids in source.
const sparse = (): unknown[] => Object.assign(new Array<unknown>(3), { 0: 1, 2: 3 });

describe("undefinedPaths", () => {
  it("says nothing about a value Firestore accepts", () => {
    expect(undefinedPaths({ a: 1, b: "x", c: null, d: [1, 2], e: {} })).toEqual([]);
  });

  // The point of naming the path: Firestore's own error names the document, so a reply built from
  // twenty sessions gives no clue which one is at fault.
  it("names the path inside nested objects", () => {
    expect(undefinedPaths({ result: { sessions: { work: undefined } } })).toEqual(["result.sessions.work"]);
  });

  it("names the index inside arrays", () => {
    expect(undefinedPaths({ sessions: [{ work: 1 }, { work: undefined }] })).toEqual(["sessions.1.work"]);
  });

  // flatMap/map SKIP the holes in a sparse array, so `[1, , 3]` reported clean and was then
  // written with a hole Firestore rejects — the same silent-pass this function exists to stop
  // (CodeRabbit review).
  it("sees the holes in a sparse array", () => {
    expect(undefinedPaths({ list: sparse() })).toEqual(["list.1"]);
  });

  it("finds every one, not just the first", () => {
    expect(undefinedPaths({ a: undefined, b: { c: undefined } })).toEqual(["a", "b.c"]);
  });

  // null is a value Firestore stores happily; conflating the two would strip real data.
  it("leaves null alone", () => {
    expect(undefinedPaths({ a: null, b: [null] })).toEqual([]);
  });

  it("names the root when the whole value is undefined", () => {
    expect(undefinedPaths(undefined)).toEqual(["(root)"]);
  });
});

describe("stripUndefined", () => {
  it("drops the key rather than nulling it", () => {
    const out = stripUndefined({ keep: 1, gone: undefined });
    expect(Object.hasOwn(out, "gone")).toBe(false);
    expect(out).toEqual({ keep: 1 });
  });

  it("reaches into nesting", () => {
    expect(stripUndefined({ a: { b: { c: undefined, d: 2 } } })).toEqual({ a: { b: { d: 2 } } });
  });

  // An array index carries meaning — removing one would shift everything after it.
  it("keeps array positions by using null", () => {
    expect(stripUndefined({ list: [1, undefined, 3] })).toEqual({ list: [1, null, 3] });
  });

  it("fills a sparse array's holes, not just its explicit undefined", () => {
    const out = stripUndefined({ list: sparse() });
    expect(out).toEqual({ list: [1, null, 3] });
    expect(out.list[1]).toBeNull(); // toEqual alone passes for a hole too
  });

  // A handler with no explicit return sends the whole reply as undefined. Warning about it and
  // handing it back unchanged left the write just as broken (CodeRabbit review).
  it("turns a root-level undefined into null", () => {
    expect(stripUndefined(undefined)).toBeNull();
  });

  it("leaves a clean value untouched", () => {
    const clean = { a: 1, b: [{ c: null }] };
    expect(stripUndefined(clean)).toEqual(clean);
  });
});

describe("matchesPath", () => {
  it("matches an exact path", () => {
    expect(matchesPath("a.b", "a.b")).toBe(true);
    expect(matchesPath("a.b", "a.c")).toBe(false);
  });

  // The reason `*` exists: an array index cannot be written out.
  it("lets * stand for one segment", () => {
    expect(matchesPath("sessions.*.work", "sessions.0.work")).toBe(true);
    expect(matchesPath("sessions.*.work", "sessions.17.work")).toBe(true);
  });

  // One segment, not many — or `a.*` would silence everything beneath `a`.
  it("does not let * span segments", () => {
    expect(matchesPath("a.*", "a.b.c")).toBe(false);
    expect(matchesPath("a.*.c", "a.c")).toBe(false);
  });

  it("requires the same depth", () => {
    expect(matchesPath("a.b", "a.b.c")).toBe(false);
    expect(matchesPath("a.b.c", "a.b")).toBe(false);
  });
});

describe("firestoreSafeHandlers", () => {
  it("passes a clean reply straight through, with no warning", async () => {
    const warn = vi.fn();
    const handlers = firestoreSafeHandlers({ list: () => ({ sessions: [{ id: "a" }] }) }, { warn });
    expect(await handlers.list()).toEqual({ sessions: [{ id: "a" }] });
    expect(warn).not.toHaveBeenCalled();
  });

  // Strip rather than throw: a throw costs the user every session in the list, which is exactly
  // the outcome this exists to prevent.
  it("strips a bad reply and says where it was", async () => {
    const warn = vi.fn();
    const handlers = firestoreSafeHandlers({ list: () => ({ sessions: [{ id: "a", work: undefined }] }) }, { warn });
    expect(await handlers.list()).toEqual({ sessions: [{ id: "a" }] });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain("sessions.0.work");
    expect(String(warn.mock.calls[0][0])).toContain("list"); // which handler
  });

  it("awaits an async handler before checking it", async () => {
    const warn = vi.fn();
    const handlers = firestoreSafeHandlers({ list: () => Promise.resolve({ a: undefined }) }, { warn });
    expect(await handlers.list()).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
  });

  it("covers every handler in the table, not just the one that broke", async () => {
    const warn = vi.fn();
    const handlers = firestoreSafeHandlers({ one: () => ({ a: undefined }), two: () => ({ b: undefined }) }, { warn });
    await handlers.one();
    await handlers.two();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("returns null when the handler returns nothing at all", async () => {
    const warn = vi.fn();
    const handlers = firestoreSafeHandlers({ list: () => undefined }, { warn });
    expect(await handlers.list()).toBeNull();
    expect(String(warn.mock.calls[0][0])).toContain("(root)");
  });

  // Two kinds of undefined. One is a bug in the sender and has to be findable; the other is an
  // optional field with no value this time, and warning about it every poll teaches everyone to
  // ignore the log. Both are stripped — Firestore leaves no choice — but only one is reported.
  it("strips a declared-optional path without saying anything", async () => {
    const warn = vi.fn();
    const handlers = firestoreSafeHandlers(
      { list: () => ({ sessions: [{ id: "a", work: undefined }] }) },
      { warn, expectedUndefined: { list: ["sessions.*.work"] } },
    );
    expect(await handlers.list()).toEqual({ sessions: [{ id: "a" }] });
    expect(warn).not.toHaveBeenCalled();
  });

  it("still reports the paths that were NOT declared", async () => {
    const warn = vi.fn();
    const handlers = firestoreSafeHandlers(
      { list: () => ({ sessions: [{ id: "a", work: undefined, oops: undefined }] }) },
      { warn, expectedUndefined: { list: ["sessions.*.work"] } },
    );
    await handlers.list();
    expect(warn).toHaveBeenCalledOnce();
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("sessions.0.oops");
    expect(message).not.toContain("sessions.0.work"); // the declared one is not noise
  });

  // The declaration is a property of ONE reply's shape; two handlers sharing a field name must not
  // silence each other.
  it("does not let one handler's declaration cover another's", async () => {
    const warn = vi.fn();
    const handlers = firestoreSafeHandlers(
      { list: () => ({ work: undefined }), other: () => ({ work: undefined }) },
      { warn, expectedUndefined: { list: ["work"] } },
    );
    await handlers.list();
    expect(warn).not.toHaveBeenCalled();
    await handlers.other();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns about everything when nothing is declared", async () => {
    const warn = vi.fn();
    const handlers = firestoreSafeHandlers({ list: () => ({ a: undefined }) }, { warn });
    await handlers.list();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps the handler names the runner advertises as capabilities", () => {
    const handlers = firestoreSafeHandlers({ alpha: () => 1, beta: () => 2 });
    expect(Object.keys(handlers)).toEqual(["alpha", "beta"]);
  });
});

// The regression itself. `expect(s.work).toBeUndefined()` passes for BOTH shapes, so it has to be
// `Object.hasOwn` — the broken form is a present key holding undefined.
describe("buildSessionList — the shape that reached Firestore (#1042)", () => {
  const listWith = (work: Map<string, { pr: number | null; issue: number | null; phase: "ready"; headline: string | null }>) =>
    buildSessionList({
      liveIds: ["with-work", "without-work"],
      tmuxIds: [],
      isResumable: () => true,
      isGridSession: () => true,
      detailOf: (id) => ({ title: `session ${id}`, cwd: `/work/${id}`, agent: "claude", work: work.get(`/work/${id}`) }),
    });

  const WORK = { pr: 987, issue: 979, phase: "ready" as const, headline: "hi" };

  it("omits the key entirely for a session with no work item", () => {
    const sessions = listWith(new Map([["/work/with-work", WORK]]));
    const bare = sessions.find((s) => s.id === "without-work");
    expect(bare).toBeDefined();
    expect(bare && Object.hasOwn(bare, "work")).toBe(false);
  });

  it("still carries the work item for the session that has one", () => {
    const sessions = listWith(new Map([["/work/with-work", WORK]]));
    expect(sessions.find((s) => s.id === "with-work")?.work).toEqual(WORK);
  });

  // The end-to-end statement: whatever the mix, the reply is writable.
  it("produces a list Firestore will accept", () => {
    expect(undefinedPaths({ sessions: listWith(new Map([["/work/with-work", WORK]])) })).toEqual([]);
    expect(undefinedPaths({ sessions: listWith(new Map()) })).toEqual([]);
  });
});
