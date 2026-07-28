// A command handler's reply, made safe to hand to Firestore (#1042).
//
// Firestore rejects `undefined` at ANY depth, and the runner in @mulmoclaude/core writes a
// handler's return value straight into the command document. So one `undefined` — anywhere in a
// reply, however deep — takes down the whole reply: the write throws, `status: "done"` never
// lands, and the phone waits until it times out. The symptom is not "one field missing" but
// "nothing works", which is what happened when a `work: undefined` reached the session list.
//
// The value here is that the failure becomes local and named. Firestore's own error points at the
// document, not at the field, so a reply built from twenty sessions gives no clue which one; the
// log line below names `result.sessions.3.work`.
//
// Strip rather than throw: a missing optional field costs one row's worth of detail, while a
// throw costs the user every session in the list — the very outcome this exists to prevent. The
// warning is what keeps it from being silent, because a stripped key IS a bug on the sending side.
//
// NOT `ignoreUndefinedProperties` on the Firestore instance: that setting makes this class of bug
// disappear into "the value just doesn't arrive", with nothing logged and nothing to grep for.

/** Every path holding `undefined`, in `a.b.0.c` form. Empty when the value is safe to write. */
export function undefinedPaths(value: unknown, prefix = ""): string[] {
  if (value === undefined) return [prefix || "(root)"];
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, i) => undefinedPaths(item, prefix ? `${prefix}.${i}` : String(i)));
  return Object.entries(value).flatMap(([key, item]) => undefinedPaths(item, prefix ? `${prefix}.${key}` : key));
}

/**
 * The same value with every `undefined` removed — object keys dropped, array holes turned into
 * `null` so the surrounding indexes still line up with what the sender meant.
 */
export function stripUndefined<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : stripUndefined(item))) as T;
  const out: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if (item !== undefined) out[key] = stripUndefined(item);
  });
  return out as T;
}

/**
 * Wrap every handler so nothing it returns can break the write.
 *
 * Applied to the whole table rather than to the one handler that broke: the reply is free-form
 * JSON from any of them, so the next `undefined` will come from somewhere else.
 */
// `...args: never[]` rather than a single param: a handler that ignores its params is written
// without one, and it still has to fit here.
type AnyHandler = (...args: never[]) => unknown;

export function firestoreSafeHandlers<T extends Record<string, AnyHandler>>(handlers: T, warn: (message: string) => void = console.warn): T {
  const wrapped = Object.entries(handlers).map(([name, handler]) => [
    name,
    async (...args: never[]) => {
      const result: unknown = await (handler as AnyHandler)(...args);
      const paths = undefinedPaths(result);
      if (paths.length > 0) {
        warn(`[remote-host] ${name} returned undefined at ${paths.join(", ")} — dropped, because Firestore refuses the whole write`);
        return stripUndefined(result);
      }
      return result;
    },
  ]);
  return Object.fromEntries(wrapped) as T;
}
