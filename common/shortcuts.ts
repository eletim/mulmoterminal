// Launcher shortcut (a pinned collection / feed), shared across the build boundary: the
// server reads and writes `<workspace>/config/shortcuts.json`, the browser's store,
// PinToggle and the toolbar launcher render it.
//
// MulmoClaude and MulmoTerminal SHARE that file — favoriting a collection in one app must
// show up in the other — so the on-disk format is the contract: an OBJECT WRAPPER
// `{ shortcuts: Shortcut[] }`, not a bare array, matching mulmoclaude/src/types/shortcuts.ts.
// Keep this type in sync with MulmoClaude's.

export const SHORTCUT_KINDS = ["collection", "feed"] as const;
export type ShortcutKind = (typeof SHORTCUT_KINDS)[number];

export interface Shortcut {
  /** Which route family — drives the launcher's navigation target. */
  kind: ShortcutKind;
  /** The target collection / feed slug. */
  slug: string;
  /** Cached display label (user-named) — refreshed on reconcile. */
  title: string;
  /** Cached material-symbols glyph — refreshed on reconcile. */
  icon: string;
}

/** True when two shortcuts target the same thing (the dedupe key). */
export function sameShortcut(left: Pick<Shortcut, "kind" | "slug">, right: Pick<Shortcut, "kind" | "slug">): boolean {
  return left.kind === right.kind && left.slug === right.slug;
}
