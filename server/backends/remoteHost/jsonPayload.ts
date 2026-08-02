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

/** A value as JSON, or undefined for something JSON has no representation for. */
export function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  // NaN and ±Infinity have no JSON form — JSON.stringify writes them as null, so this does too
  // rather than dropping the key and changing the shape the client sees.
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // An element JSON cannot represent becomes null rather than vanishing: dropping it would shift
  // every later index, which is what JSON.stringify avoids by writing null.
  if (Array.isArray(value)) return value.map((entry) => toJsonValue(entry) ?? null);
  if (isRecord(value)) return jsonPayload(value);
  return undefined;
}

/** A record as JSON. Keys whose value JSON cannot represent are omitted, as JSON.stringify omits
 *  them. Named apart from core's `toJsonObject`, which two of the callers also import. */
export function jsonPayload(value: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    const json = toJsonValue(entry);
    if (json !== undefined) out[key] = json;
  }
  return out;
}
