// Editing the notification-sound settings, as pure functions.
//
// They live beside the composables rather than beside SettingsModal because useAppConfig reads
// the same shape off the wire, and a composable importing from components/ would have the
// dependency backwards.
//
// These were inline in SettingsModal.vue, where the only way to reach them was to mount the
// component — and the one that rebuilds the per-kind map is where a real bug lived (it read
// the SAVED map, so two picks made before the first save answered lost the earlier one). The
// map is persisted whole on every change, so an off-by-one here silently discards a setting;
// that is worth testing directly rather than through a click.

import { NOTIFY_KINDS, type NotifyKind } from "../../common/notifyKinds";
import { parsePresetRef } from "../../common/notifySounds";

export type SoundMap = Partial<Record<NotifyKind, string>>;

/**
 * `current` with `kind` set to `value`, or with its entry REMOVED when `value` is empty —
 * "use the fallback" is the absence of an entry, not an empty string, and an empty string
 * would be stored and then resolve to nothing.
 *
 * Rebuilt rather than edited so the result carries only known kinds, in a stable order.
 */
export function withKindSound(current: SoundMap, kind: NotifyKind, value: string): SoundMap {
  const next: SoundMap = {};
  NOTIFY_KINDS.forEach((k) => {
    const chosen = k === kind ? value : (current[k] ?? "");
    if (chosen) next[k] = chosen;
  });
  return next;
}

/** `current` with `kind` toggled, always in NOTIFY_KINDS order so the saved list reads the
 *  same however it was clicked. */
export function toggledKinds(current: readonly NotifyKind[], kind: NotifyKind): NotifyKind[] {
  const next = current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind];
  return NOTIFY_KINDS.filter((k) => next.includes(k));
}

/** Whether a stored value is the user's own file rather than a preset — the case the picker
 *  has no option for, and so has to add one for rather than drop it. */
export const isCustomSound = (value: string): boolean => Boolean(value) && !parsePresetRef(value);

/** How that file is named in the picker: its basename, on either path separator. */
export const customSoundLabel = (value: string): string => `Your file — ${value.split(/[\\/]/).pop() || value}`;

/**
 * A `sounds` map read off a /api/config response: known kinds with a non-empty string value,
 * and nothing else. The server sanitizes the same map, but the response is still just JSON —
 * an unknown key here would reach the player as a fetch for a kind that has no route.
 */
export function readSoundMap(raw: Record<string, unknown>): SoundMap {
  const out: SoundMap = {};
  NOTIFY_KINDS.forEach((kind) => {
    const value = raw[kind];
    if (typeof value === "string" && value) out[kind] = value;
  });
  return out;
}
