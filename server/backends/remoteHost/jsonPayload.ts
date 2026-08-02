// Turning a domain value into the JSON the remote-host channel actually sends.
//
// `toJsonObject` (from @mulmoclaude/core/remote-host) takes `Jsonify<T>`, which a payload built
// from collection types cannot satisfy: `CollectionItem` and `RemoteViewPage` carry
// `unknown`-valued index signatures, and `unknown` is not provably JSON. Three handlers therefore
// asserted their way to `JsonObject`, one of them through `as unknown as` — the shape simply does
// not overlap.
//
// This CONVERTS instead of asserting, so the claim becomes true rather than declared. The values
// are about to be JSON.stringify'd onto the wire anyway, so the walk sees exactly what the client
// would have received: anything JSON.stringify drops (functions, symbols, undefined) is dropped
// here too, in the same places.
import { isRecord } from "../../../common/isRecord.js";
import type { JsonObject, JsonValue } from "@mulmoclaude/core/remote-host";

// `toJSON` is how a Date (and anything else defining it) becomes JSON — stringify calls it before
// looking at the object's own keys, so this must too or a Date would serialize as `{}`.
//
// The PROPERTY KEY is passed along, because stringify passes it: a custom `toJSON(key)` may answer
// differently per field, and calling it with nothing silently changes that answer (Codex on #1288).
const isToJson = (value: unknown): value is (this: unknown, key: string) => unknown => typeof value === "function";

// Everything except the `toJSON` step, which stringify applies once per value rather than to its
// own result — so the recursion below deliberately re-enters here, not at toJsonValue.
function convert(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  // NaN and ±Infinity have no JSON form — JSON.stringify writes them as null, so this does too
  // rather than dropping the key and changing the shape the client sees.
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // stringify THROWS on a bigint rather than skipping it. Matching that matters: dropping it
  // instead would ship a payload silently missing a field.
  if (typeof value === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
  // An element JSON cannot represent becomes null rather than vanishing: dropping it would shift
  // every later index, which is what JSON.stringify avoids by writing null. The index is the key
  // stringify hands an element's toJSON.
  if (Array.isArray(value)) return value.map((entry, index) => toJsonValue(entry, String(index)) ?? null);
  // Boxed primitives serialize as their PRIMITIVE, not as the object they are. Without this the
  // walk below would turn `new String("ab")` into `{"0":"a","1":"b"}` and the other two into `{}`
  // (Codex review on #1288). `valueOf` is what stringify unwraps them with.
  if (value instanceof String) return value.valueOf();
  if (value instanceof Number) return Number.isFinite(value.valueOf()) ? value.valueOf() : null;
  if (value instanceof Boolean) return value.valueOf();
  if (isRecord(value)) return jsonPayload(value);
  return undefined;
}

/** A value as JSON, or undefined for something JSON has no representation for. */
export function toJsonValue(value: unknown, key = ""): JsonValue | undefined {
  const toJson = isRecord(value) ? value.toJSON : undefined;
  return isToJson(toJson) ? convert(toJson.call(value, key)) : convert(value);
}

/** A record as JSON. Keys whose value JSON cannot represent are omitted, as JSON.stringify omits
 *  them. Named apart from core's `toJsonObject`, which two of the callers also import. */
export function jsonPayload(value: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    const json = toJsonValue(entry, key);
    if (json === undefined) continue;
    // defineProperty, not `out[key] =`: a payload carrying a literal `"__proto__"` key would
    // otherwise assign the object's PROTOTYPE and the key would vanish from the output — a silent
    // divergence from JSON.stringify, which keeps it as an ordinary key (Codex review on #1288).
    Object.defineProperty(out, key, { value: json, writable: true, enumerable: true, configurable: true });
  }
  return out;
}
