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
// throw costs the user every session in the list — the very outcome this exists to prevent.
//
// Whether that removal is WORTH SAYING OUT LOUD is a separate question, and it has two answers.
// An `undefined` where none belongs is a bug in the sender and has to be findable. An optional
// field that simply has no value this time is normal, and warning about it every poll teaches
// everyone to ignore the log. So the caller declares which paths are the second kind; everything
// else is treated as the first.
//
// NOT `ignoreUndefinedProperties` on the Firestore instance: that setting makes this class of bug
// disappear into "the value just doesn't arrive", with nothing logged and nothing to grep for.

// Only a PLAIN object or an array is walked into. Firestore stores a Date, a Timestamp, a
// GeoPoint, a DocumentReference and Bytes as themselves, and rebuilding one of those from its
// entries turns it into `{}` — the guard would then destroy a valid value while looking for an
// invalid one. Anything with a prototype of its own is left exactly as it came.
const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Every path holding `undefined`, in `a.b.0.c` form. Empty when the value is safe to write. */
export function undefinedPaths(value: unknown, prefix = ""): string[] {
  if (value === undefined) return [prefix || "(root)"];
  if (value === null || typeof value !== "object") return [];
  // Array.from, not flatMap: a SPARSE array's holes are skipped by flatMap/map, so `[1, , 3]`
  // would be reported clean and then written with a hole Firestore rejects (CodeRabbit review).
  if (Array.isArray(value)) return Array.from(value).flatMap((item, i) => undefinedPaths(item, prefix ? `${prefix}.${i}` : String(i)));
  if (!isPlainObject(value)) return []; // a Date/Timestamp/Bytes holds no undefined to find
  return Object.entries(value).flatMap(([key, item]) => undefinedPaths(item, prefix ? `${prefix}.${key}` : key));
}

/**
 * The same value with every `undefined` removed — object keys dropped, array holes turned into
 * `null` so the surrounding indexes still line up with what the sender meant.
 */
export function stripUndefined<T>(value: T): T {
  // The whole reply can be undefined — a handler with no explicit return. Warning about it and
  // then handing it back unchanged left the write just as broken (CodeRabbit review); null is what
  // core already substitutes for a missing result.
  if (value === undefined) return null as T;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Array.from(value, (item) => (item === undefined ? null : stripUndefined(item))) as T;
  if (!isPlainObject(value)) return value; // rebuilding a Date from its entries would yield {}
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
/**
 * Does `path` match `pattern`? `*` stands for exactly one segment — ANY segment, not just a
 * numeric index, though an index is what it was added for (`sessions.*.work`). One segment and
 * not more, so `a.*` cannot silence everything beneath `a`.
 */
export function matchesPath(pattern: string, path: string): boolean {
  const patternParts = pattern.split(".");
  const pathParts = path.split(".");
  return patternParts.length === pathParts.length && patternParts.every((part, i) => part === "*" || part === pathParts[i]);
}

export interface FirestoreSafeOptions {
  warn?: (message: string) => void;
  /**
   * Per handler, the paths where `undefined` is a legitimate "no value this time" rather than a
   * bug. Those are stripped in silence; everything else is stripped AND reported.
   *
   * Keyed by handler name so the declaration reads as a property of that reply's shape, and so two
   * handlers that happen to share a field name do not silence each other.
   */
  expectedUndefined?: Readonly<Record<string, readonly string[]>>;
}

// `...args: never[]` rather than a single param: a handler that ignores its params is written
// without one, and it still has to fit here.
type AnyHandler = (...args: never[]) => unknown;

/** The paths worth reporting: those the caller did not declare as legitimately absent. */
function unexpectedPaths(paths: readonly string[], expected: readonly string[]): string[] {
  return paths.filter((path) => !expected.some((pattern) => matchesPath(pattern, path)));
}

function guardOne(name: string, handler: AnyHandler, options: FirestoreSafeOptions): AnyHandler {
  const warn = options.warn ?? console.warn;
  const expected = options.expectedUndefined?.[name] ?? [];
  return async (...args: never[]) => {
    const result: unknown = await handler(...args);
    const unexpected = unexpectedPaths(undefinedPaths(result), expected);
    if (unexpected.length > 0) {
      warn(`[remote-host] ${name} returned undefined at ${unexpected.join(", ")} — dropped, because Firestore refuses the whole write`);
    }
    return stripUndefined(result);
  };
}

export function firestoreSafeHandlers<T extends Record<string, AnyHandler>>(handlers: T, options: FirestoreSafeOptions = {}): T {
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, guardOne(name, handler as AnyHandler, options)])) as T;
}
