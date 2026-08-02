// @vitest-environment node
import { describe, it, expect } from "vitest";
import { jsonPayload, toJsonValue } from "../../../../server/backends/remoteHost/jsonPayload.js";

// The point of this module is that the RESULT equals what the client would have received when the
// payload was asserted to be JSON and stringified. So the yardstick is JSON.stringify itself.
const stringified = (value: Record<string, unknown>): unknown => JSON.parse(JSON.stringify(value));

describe("jsonPayload", () => {
  it("passes scalars, arrays and nested records through unchanged", () => {
    const value = { s: "a", n: 1, b: true, nul: null, arr: [1, "two", false], deep: { inner: { k: [1, 2] } } };
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  it("omits keys JSON has no representation for, as stringify does", () => {
    const value = { kept: "yes", fn: () => 1, undef: undefined, sym: Symbol("x") };
    expect(jsonPayload(value)).toEqual({ kept: "yes" });
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  // Dropping the element instead would shift every later index — a row landing under the wrong
  // one on the phone. stringify writes null for exactly this reason.
  it("writes null for an array element JSON cannot represent, keeping positions", () => {
    const value = { list: [1, () => 2, 3] };
    expect(jsonPayload(value)).toEqual({ list: [1, null, 3] });
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  it("writes null for NaN and Infinity, as stringify does", () => {
    const value = { nan: NaN, inf: Infinity, negInf: -Infinity };
    expect(jsonPayload(value)).toEqual({ nan: null, inf: null, negInf: null });
    expect(jsonPayload(value)).toEqual(stringified(value));
  });

  // The shape the handlers actually hand it: an `unknown`-valued index signature holding JSON.
  it("converts a collection-item-shaped record", () => {
    const item: Record<string, unknown> = { id: "r1", title: "Row", tags: ["a", "b"], meta: { count: 2 } };
    expect(jsonPayload({ op: "update", item })).toEqual({ op: "update", item });
  });

  // A payload carrying a literal "__proto__" key: `out[key] =` would assign the PROTOTYPE and the
  // key would disappear from the output, while JSON.stringify keeps it (Codex review on #1288).
  it("keeps a literal __proto__ key instead of touching the prototype", () => {
    const value: Record<string, unknown> = JSON.parse('{"__proto__": {"polluted": true}, "keep": 1}');
    const out = jsonPayload(value);
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(true);
    expect(JSON.stringify(out)).toBe(JSON.stringify(stringified(value)));
    // The prototype itself is untouched — nothing leaked onto Object.prototype.
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect("polluted" in {}).toBe(false);
  });

  it("is empty for an empty record", () => {
    expect(jsonPayload({})).toEqual({});
  });
});

describe("toJsonValue", () => {
  it("answers undefined for values JSON cannot represent", () => {
    expect(toJsonValue(undefined)).toBeUndefined();
    expect(toJsonValue(() => 1)).toBeUndefined();
    expect(toJsonValue(Symbol("x"))).toBeUndefined();
  });

  it("keeps null distinct from absent", () => {
    expect(toJsonValue(null)).toBeNull();
  });
});
