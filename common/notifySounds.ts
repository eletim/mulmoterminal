// The preset attention sounds, and how a configured sound names one.
//
// The audio lives in the ownplate repo (MIT, same org) rather than in this package, so an
// install doesn't carry ~380 KB of audio nobody may play. The server fetches a preset once
// into ~/.mulmoterminal/sounds/ and serves it from there afterwards, so it keeps working
// offline — see server/config/sound-presets.ts.

// Pinned to the commit that last touched these files (2022-03-30) rather than to a branch:
// a branch ref would let the bytes behind a cached preset change, and a user who picked
// "coin" would silently get something else on a machine that hadn't cached it yet.
export const SOUND_PRESET_COMMIT = "fb36eb8748b7f3d181d7fc0e366e01971a56ad2f";
export const SOUND_PRESET_BASE_URL = `https://raw.githubusercontent.com/Nakajima-Foundation/ownplate/${SOUND_PRESET_COMMIT}/public/`;

export interface SoundPreset {
  id: string;
  file: string;
  label: string;
}

export const SOUND_PRESETS: readonly SoundPreset[] = [
  { id: "chime", file: "sound_default.mp3", label: "Chime" },
  { id: "coin", file: "sound_coin.mp3", label: "Coin" },
  { id: "cheep", file: "sound_cheep_cheep.mp3", label: "Cheep" },
  { id: "door", file: "sound_door_chime.mp3", label: "Door chime" },
  { id: "gong", file: "sound_gong.mp3", label: "Gong" },
  { id: "magic", file: "sound_magic.mp3", label: "Magic" },
  { id: "meow", file: "sound_meow.mp3", label: "Meow" },
];

// A sound value is either a preset reference or a path to the user's own file. The prefix is
// what tells them apart, and it can't collide with a path: an absolute path starts with "/"
// (or a drive letter), and a relative one is rejected before it gets here.
const PRESET_PREFIX = "preset:";

export const presetRef = (id: string): string => `${PRESET_PREFIX}${id}`;

export const soundPresetById = (id: string): SoundPreset | null => SOUND_PRESETS.find((preset) => preset.id === id) ?? null;

/** The preset id in a `preset:<id>` value, or null when it names a file path or an unknown preset. */
export function parsePresetRef(value: string): string | null {
  if (!value.startsWith(PRESET_PREFIX)) return null;
  const id = value.slice(PRESET_PREFIX.length);
  return soundPresetById(id) ? id : null;
}
